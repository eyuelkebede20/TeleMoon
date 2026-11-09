import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'models.dart';

class SyncDB {
  static final SyncDB instance = SyncDB._internal();
  SyncDB._internal();

  Database? _db;
  String? _customDbPath;

  Future<Database> get db async {
    if (_db != null) return _db!;
    _db = await _init();
    return _db!;
  }

  void setDbForTesting(Database? testDb) {
    _db = testDb;
  }

  void setCustomDbPath(String? path) {
    _customDbPath = path;
    _db = null;
  }

  static void ensureInitialized() {
    if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    }
  }

  Future<Database> _init() async {
    ensureInitialized();
    String dbPath;
    if (_customDbPath != null) {
      dbPath = _customDbPath!;
    } else {
      Directory dir;
      try {
        dir = await getApplicationSupportDirectory();
      } catch (_) {
        dir = Directory.current;
      }
      dbPath = p.join(dir.path, 'telemoon_sync.db');
    }

    return await openDatabase(
      dbPath,
      version: 1,
      onConfigure: (d) async {
        await d.execute('PRAGMA journal_mode = WAL;');
        await d.execute('PRAGMA busy_timeout = 5000;');
      },
      onCreate: (d, v) async {
        await d.execute('''
          CREATE TABLE entries (
            entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT UNIQUE,
            type TEXT NOT NULL CHECK (type IN ('file','folder')),
            base_parent_id TEXT,
            base_name TEXT,
            base_version INTEGER,
            base_hash TEXT,
            base_size INTEGER,
            remote_parent_id TEXT,
            remote_name TEXT,
            remote_version INTEGER,
            remote_hash TEXT,
            remote_size INTEGER,
            remote_deleted INTEGER NOT NULL DEFAULT 0,
            local_rel_path TEXT,
            local_file_id TEXT,
            local_size INTEGER,
            local_mtime_ns INTEGER,
            local_hash TEXT,
            local_present INTEGER NOT NULL DEFAULT 0,
            excluded INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'synced',
            status_detail TEXT,
            updated_at INTEGER NOT NULL
          )
        ''');
        await d.execute('CREATE UNIQUE INDEX idx_entries_path ON entries(local_rel_path COLLATE NOCASE) WHERE local_rel_path IS NOT NULL');

        await d.execute('''
          CREATE TABLE pending_ops (
            op_id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
          )
        ''');

        await d.execute('''
          CREATE TABLE kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        ''');
      },
    );
  }

  Future<void> setKv(String key, String value) async {
    final d = await db;
    await d.insert(
      'kv',
      {'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<String?> getKv(String key) async {
    final d = await db;
    final rows = await d.query('kv', where: 'key = ?', whereArgs: [key]);
    if (rows.isEmpty) return null;
    return rows.first['value'] as String?;
  }

  Future<List<String>> getTrackedPaths() async {
    final raw = await getKv('tracked_paths');
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list.map((e) => e.toString()).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveTrackedPaths(List<String> paths) async {
    await setKv('tracked_paths', jsonEncode(paths));
  }

  Future<List<String>> getExcludedPaths() async {
    final raw = await getKv('excluded_paths');
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list.map((e) => e.toString()).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveExcludedPaths(List<String> paths) async {
    await setKv('excluded_paths', jsonEncode(paths));
  }

  Future<void> setEntriesExcludedByPrefix(String prefix, bool excluded) async {
    final d = await db;
    final normalized = prefix.replaceAll(r'\', '/').toLowerCase();
    final val = excluded ? 1 : 0;
    await d.rawUpdate('''
      UPDATE entries 
      SET excluded = ? 
      WHERE LOWER(local_rel_path) = ? 
         OR LOWER(local_rel_path) LIKE ? 
         OR LOWER(remote_name) = ?
    ''', [val, normalized, '$normalized/%', normalized]);
  }

  Future<List<SyncEntry>> getAllEntries() async {
    final d = await db;
    final rows = await d.query('entries');
    return rows.map((r) => _mapToEntry(r)).toList();
  }

  Future<SyncEntry?> getEntryByNodeId(String nodeId) async {
    final d = await db;
    final rows = await d.query('entries', where: 'node_id = ?', whereArgs: [nodeId]);
    if (rows.isEmpty) return null;
    return _mapToEntry(rows.first);
  }

  Future<SyncEntry?> getEntryByLocalPath(String relPath) async {
    final d = await db;
    final rows = await d.query('entries', where: 'local_rel_path = ? COLLATE NOCASE', whereArgs: [relPath]);
    if (rows.isEmpty) return null;
    return _mapToEntry(rows.first);
  }

  Future<int> saveEntry(SyncEntry entry) async {
    final d = await db;
    final map = _entryToMap(entry);
    map['updated_at'] = DateTime.now().millisecondsSinceEpoch;

    if (entry.entryId != null) {
      await d.update('entries', map, where: 'entry_id = ?', whereArgs: [entry.entryId]);
      return entry.entryId!;
    } else {
      final id = await d.insert('entries', map, conflictAlgorithm: ConflictAlgorithm.replace);
      entry.entryId = id;
      return id;
    }
  }

  Future<void> deleteEntry(int entryId) async {
    final d = await db;
    await d.delete('entries', where: 'entry_id = ?', whereArgs: [entryId]);
  }

  Future<void> clearAll() async {
    final d = await db;
    await d.delete('entries');
    await d.delete('pending_ops');
    await d.delete('kv');
  }

  SyncEntry _mapToEntry(Map<String, dynamic> r) {
    return SyncEntry(
      entryId: r['entry_id'] as int?,
      nodeId: r['node_id'] as String?,
      type: r['type'] as String,
      baseParentId: r['base_parent_id'] as String?,
      baseName: r['base_name'] as String?,
      baseVersion: r['base_version'] as int?,
      baseHash: r['base_hash'] as String?,
      baseSize: r['base_size'] as int?,
      remoteParentId: r['remote_parent_id'] as String?,
      remoteName: r['remote_name'] as String?,
      remoteVersion: r['remote_version'] as int?,
      remoteHash: r['remote_hash'] as String?,
      remoteSize: r['remote_size'] as int?,
      remoteDeleted: (r['remote_deleted'] as int? ?? 0) == 1,
      localRelPath: r['local_rel_path'] as String?,
      localFileId: r['local_file_id'] as String?,
      localSize: r['local_size'] as int?,
      localMtimeNs: r['local_mtime_ns'] as int?,
      localHash: r['local_hash'] as String?,
      localPresent: (r['local_present'] as int? ?? 0) == 1,
      excluded: (r['excluded'] as int? ?? 0) == 1,
      status: r['status'] as String? ?? 'synced',
      statusDetail: r['status_detail'] as String?,
    );
  }

  Map<String, dynamic> _entryToMap(SyncEntry e) {
    return {
      if (e.entryId != null) 'entry_id': e.entryId,
      'node_id': e.nodeId,
      'type': e.type,
      'base_parent_id': e.baseParentId,
      'base_name': e.baseName,
      'base_version': e.baseVersion,
      'base_hash': e.baseHash,
      'base_size': e.baseSize,
      'remote_parent_id': e.remoteParentId,
      'remote_name': e.remoteName,
      'remote_version': e.remoteVersion,
      'remote_hash': e.remoteHash,
      'remote_size': e.remoteSize,
      'remote_deleted': e.remoteDeleted ? 1 : 0,
      'local_rel_path': e.localRelPath,
      'local_file_id': e.localFileId,
      'local_size': e.localSize,
      'local_mtime_ns': e.localMtimeNs,
      'local_hash': e.localHash,
      'local_present': e.localPresent ? 1 : 0,
      'excluded': e.excluded ? 1 : 0,
      'status': e.status,
      'status_detail': e.statusDetail,
    };
  }
}
