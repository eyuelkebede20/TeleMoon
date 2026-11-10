import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'models.dart';
import 'planner.dart';
import 'scanner.dart';
import 'sync_api.dart';
import 'sync_db.dart';

enum SyncStatus {
  idle,
  syncing,
  paused,
  error,
}

class SyncEngineState {
  final SyncStatus status;
  final String message;
  final int completedOps;
  final int totalOps;
  final DateTime? lastSyncTime;
  final List<String> conflicts;
  final String? syncRoot;
  final Set<String> trackedPaths;
  final Set<String> excludedPaths;
  final bool selectiveSyncMode;

  SyncEngineState({
    this.status = SyncStatus.idle,
    this.message = 'Idle',
    this.completedOps = 0,
    this.totalOps = 0,
    this.lastSyncTime,
    this.conflicts = const [],
    this.syncRoot,
    this.trackedPaths = const {},
    this.excludedPaths = const {},
    this.selectiveSyncMode = false,
  });

  SyncEngineState copyWith({
    SyncStatus? status,
    String? message,
    int? completedOps,
    int? totalOps,
    DateTime? lastSyncTime,
    List<String>? conflicts,
    String? syncRoot,
    Set<String>? trackedPaths,
    Set<String>? excludedPaths,
    bool? selectiveSyncMode,
  }) {
    return SyncEngineState(
      status: status ?? this.status,
      message: message ?? this.message,
      completedOps: completedOps ?? this.completedOps,
      totalOps: totalOps ?? this.totalOps,
      lastSyncTime: lastSyncTime ?? this.lastSyncTime,
      conflicts: conflicts ?? this.conflicts,
      syncRoot: syncRoot ?? this.syncRoot,
      trackedPaths: trackedPaths ?? this.trackedPaths,
      excludedPaths: excludedPaths ?? this.excludedPaths,
      selectiveSyncMode: selectiveSyncMode ?? this.selectiveSyncMode,
    );
  }
}

class SyncEngine {
  static final SyncEngine instance = SyncEngine._internal();
  SyncEngine._internal();

  final ValueNotifier<SyncEngineState> state = ValueNotifier(SyncEngineState());
  final SyncDB _db = SyncDB.instance;

  SyncApiClient? _api;
  Directory? _syncRoot;
  bool _isSyncing = false;
  Timer? _periodicTimer;

  Set<String> _trackedPaths = {};
  Set<String> _excludedPaths = {};
  bool _selectiveSyncMode = false;

  Set<String> get trackedPaths => Set.unmodifiable(_trackedPaths);
  Set<String> get excludedPaths => Set.unmodifiable(_excludedPaths);
  bool get selectiveSyncMode => _selectiveSyncMode;

  Future<void> loadTrackingRules() async {
    final tr = await _db.getTrackedPaths();
    final ex = await _db.getExcludedPaths();
    final sel = (await _db.getKv('selective_sync_mode')) == '1';
    _trackedPaths = tr.toSet();
    _excludedPaths = ex.toSet();
    _selectiveSyncMode = sel;
    _updateTrackingState();
  }

  void _updateTrackingState() {
    state.value = state.value.copyWith(
      trackedPaths: Set.from(_trackedPaths),
      excludedPaths: Set.from(_excludedPaths),
      selectiveSyncMode: _selectiveSyncMode,
    );
  }

  bool isTracked(String pathOrName) {
    final norm = pathOrName.replaceAll('\\', '/').toLowerCase().trim();
    if (norm.isEmpty) return true;

    // Direct exclude or parent folder excluded
    for (final ex in _excludedPaths) {
      final exNorm = ex.toLowerCase();
      if (norm == exNorm || norm.startsWith('$exNorm/')) {
        return false;
      }
    }

    if (!_selectiveSyncMode) {
      // Standard mode: sync all unless excluded
      return true;
    }

    // Selective sync mode: must match or be inside a tracked path
    for (final tr in _trackedPaths) {
      final trNorm = tr.toLowerCase();
      if (norm == trNorm || norm.startsWith('$trNorm/') || trNorm.startsWith('$norm/')) {
        return true;
      }
    }
    return false;
  }

  Future<void> trackPath(String pathOrName) async {
    final norm = pathOrName.replaceAll('\\', '/').trim();
    if (norm.isEmpty) return;
    _excludedPaths.removeWhere((e) => e.toLowerCase() == norm.toLowerCase());
    _trackedPaths.add(norm);
    await _db.saveTrackedPaths(_trackedPaths.toList());
    await _db.saveExcludedPaths(_excludedPaths.toList());
    await _db.setEntriesExcludedByPrefix(norm, false);
    _updateTrackingState();
  }

  Future<void> untrackPath(String pathOrName) async {
    final norm = pathOrName.replaceAll('\\', '/').trim();
    if (norm.isEmpty) return;
    _trackedPaths.removeWhere((e) => e.toLowerCase() == norm.toLowerCase());
    _excludedPaths.add(norm);
    await _db.saveTrackedPaths(_trackedPaths.toList());
    await _db.saveExcludedPaths(_excludedPaths.toList());
    await _db.setEntriesExcludedByPrefix(norm, true);
    _updateTrackingState();
  }

  Future<void> toggleTracking(String pathOrName) async {
    if (isTracked(pathOrName)) {
      await untrackPath(pathOrName);
    } else {
      await trackPath(pathOrName);
    }
  }

  Future<void> setSelectiveSyncMode(bool enabled) async {
    _selectiveSyncMode = enabled;
    await _db.setKv('selective_sync_mode', enabled ? '1' : '0');
    _updateTrackingState();
  }


  void configure({
    required String baseUrl,
    required String token,
    required String deviceId,
    required Directory syncRoot,
  }) {
    _api = SyncApiClient(baseUrl: baseUrl, token: token, deviceId: deviceId);
    _syncRoot = syncRoot;
    state.value = state.value.copyWith(syncRoot: syncRoot.path);
    loadTrackingRules();
  }

  void startPeriodicSync({Duration interval = const Duration(seconds: 30)}) {
    _periodicTimer?.cancel();
    _periodicTimer = Timer.periodic(interval, (_) => sync());
  }

  void stopPeriodicSync() {
    _periodicTimer?.cancel();
    _periodicTimer = null;
  }

  Future<void> sync() async {
    if (_isSyncing) return;
    if (_api == null || _syncRoot == null) return;

    if (!await _syncRoot!.exists()) {
      await _syncRoot!.create(recursive: true);
    }

    _isSyncing = true;
    state.value = state.value.copyWith(
      status: SyncStatus.syncing,
      message: 'Checking for changes...',
      completedOps: 0,
      totalOps: 0,
    );

    try {
      // 1. Remote Delta Pull
      state.value = state.value.copyWith(message: 'Pulling remote changes...');
      await _pullRemoteChanges();

      // 2. Local Filesystem Scan
      state.value = state.value.copyWith(message: 'Scanning local files...');
      final scanned = await LocalScanner.scan(_syncRoot!);
      await _mergeLocalScan(scanned);

      // 3. Planner
      final entries = await _db.getAllEntries();
      final ops = Planner.plan(entries, deviceName: Platform.localHostname);

      // 4. Execution
      if (ops.isNotEmpty) {
        state.value = state.value.copyWith(
          message: 'Executing sync operations...',
          totalOps: ops.length,
          completedOps: 0,
        );

        for (int i = 0; i < ops.length; i++) {
          final op = ops[i];
          state.value = state.value.copyWith(
            message: 'Syncing: ${op.kind.name} (${i + 1}/${ops.length})',
            completedOps: i,
          );
          await _executeOp(op);
        }
      }

      state.value = state.value.copyWith(
        status: SyncStatus.idle,
        message: 'All files up to date',
        completedOps: ops.length,
        totalOps: ops.length,
        lastSyncTime: DateTime.now(),
      );
    } catch (e) {
      state.value = state.value.copyWith(
        status: SyncStatus.error,
        message: 'Sync error: $e',
      );
    } finally {
      _isSyncing = false;
    }
  }

  Future<void> _pullRemoteChanges() async {
    final rawCursor = await _db.getKv('last_cursor');
    int cursor = int.tryParse(rawCursor ?? '0') ?? 0;

    if (cursor == 0) {
      // Initial sync via snapshot
      String? after;
      int snapshotCursor = 0;
      do {
        final snap = await _api!.fetchSnapshot(after: after);
        snapshotCursor = snap['snapshotCursor'] as int? ?? 0;
        final nodes = snap['nodes'] as List<dynamic>? ?? [];
        for (final node in nodes) {
          final m = node as Map<String, dynamic>;
          await _applyRemoteNode(m);
        }
        after = snap['nextAfter'] as String?;
      } while (after != null);

      await _db.setKv('last_cursor', snapshotCursor.toString());
    } else {
      // Delta pull
      bool hasMore = true;
      while (hasMore) {
        final delta = await _api!.fetchDelta(cursor: cursor);
        cursor = delta['cursor'] as int? ?? cursor;
        hasMore = delta['hasMore'] as bool? ?? false;

        final changes = delta['changes'] as List<dynamic>? ?? [];
        for (final c in changes) {
          final m = c as Map<String, dynamic>;
          final nodeId = m['nodeId'] as String;
          final isDel = m['deleted'] == true || m['action'] == 'DELETE';

          var entry = await _db.getEntryByNodeId(nodeId);
          if (entry == null) {
            entry = SyncEntry(
              nodeId: nodeId,
              type: m['type'] as String? ?? 'file',
              remoteParentId: m['parentId'] as String?,
              remoteName: m['name'] as String?,
              remoteVersion: m['version'] as int?,
              remoteHash: m['hash'] as String?,
              remoteSize: m['size'] as int?,
              remoteDeleted: isDel,
              localRelPath: m['name'] as String?,
              localPresent: false,
            );
          } else {
            entry.remoteParentId = m['parentId'] as String?;
            entry.remoteName = m['name'] as String?;
            entry.remoteVersion = m['version'] as int?;
            entry.remoteHash = m['hash'] as String?;
            entry.remoteSize = m['size'] as int?;
            entry.remoteDeleted = isDel;
          }
          entry.excluded = !isTracked(entry.localRelPath ?? entry.remoteName ?? '');
          await _db.saveEntry(entry);
        }
        await _db.setKv('last_cursor', cursor.toString());
      }
    }
  }

  Future<void> _applyRemoteNode(Map<String, dynamic> m) async {
    final nodeId = m['id'] as String;
    var entry = await _db.getEntryByNodeId(nodeId);
    if (entry == null) {
      entry = SyncEntry(
        nodeId: nodeId,
        type: m['type'] as String? ?? 'file',
        remoteParentId: m['parent_id'] as String?,
        remoteName: m['name'] as String?,
        remoteVersion: m['version'] as int? ?? 1,
        remoteHash: m['hash'] as String?,
        remoteSize: m['size'] as int? ?? 0,
        remoteDeleted: m['deleted_at'] != null,
        localRelPath: m['name'] as String?,
        localPresent: false,
      );
    } else {
      entry.remoteParentId = m['parent_id'] as String?;
      entry.remoteName = m['name'] as String?;
      entry.remoteVersion = m['version'] as int? ?? entry.remoteVersion;
      entry.remoteHash = m['hash'] as String?;
      entry.remoteSize = m['size'] as int? ?? 0;
      entry.remoteDeleted = m['deleted_at'] != null;
    }
    entry.excluded = !isTracked(entry.localRelPath ?? entry.remoteName ?? '');
    await _db.saveEntry(entry);
  }

  Future<void> _mergeLocalScan(Map<String, ScannedItem> scanned) async {
    final entries = await _db.getAllEntries();
    final entryByPath = {for (final e in entries) if (e.localRelPath != null) e.localRelPath!.toLowerCase(): e};

    // Mark missing local items
    for (final e in entries) {
      if (e.localRelPath != null && !scanned.containsKey(e.localRelPath)) {
        if (e.localPresent) {
          e.localPresent = false;
          await _db.saveEntry(e);
        }
      }
    }

    // Upsert scanned items
    for (final entryItem in scanned.entries) {
      final relPath = entryItem.key;
      final item = entryItem.value;
      final existing = entryByPath[relPath.toLowerCase()];

      if (existing != null) {
        existing.localPresent = true;
        existing.localRelPath = relPath;
        existing.localSize = item.size;
        existing.localMtimeNs = item.mtimeMs * 1000000;
        existing.localHash = item.hash;
        existing.excluded = !isTracked(relPath);
        await _db.saveEntry(existing);
      } else {
        final newEntry = SyncEntry(
          type: item.isDirectory ? 'folder' : 'file',
          localRelPath: relPath,
          localPresent: true,
          localSize: item.size,
          localMtimeNs: item.mtimeMs * 1000000,
          localHash: item.hash,
          excluded: !isTracked(relPath),
        );
        await _db.saveEntry(newEntry);
      }
    }
  }

  Future<void> _executeOp(SyncOp op) async {
    final root = _syncRoot!.path;
    final rel = op.payload['relPath'] as String? ?? '';

    switch (op.kind) {
      case SyncOpKind.mkdirLocal:
        final dir = Directory(p.join(root, rel));
        if (!await dir.exists()) {
          await dir.create(recursive: true);
        }
        if (op.entryId != null) {
          final entry = (await _db.getAllEntries()).firstWhere((e) => e.entryId == op.entryId);
          entry.baseVersion = entry.remoteVersion;
          entry.baseName = entry.remoteName;
          entry.baseParentId = entry.remoteParentId;
          entry.localPresent = true;
          await _db.saveEntry(entry);
        }
        break;

      case SyncOpKind.mkdirRemote:
        final name = op.payload['name'] as String;
        final res = await _api!.createFolder(parentId: 'root', name: name);
        if (op.entryId != null) {
          final entry = (await _db.getAllEntries()).firstWhere((e) => e.entryId == op.entryId);
          entry.nodeId = res['id'] as String;
          entry.baseVersion = res['version'] as int? ?? 1;
          entry.baseName = name;
          entry.remoteVersion = entry.baseVersion;
          entry.remoteName = name;
          await _db.saveEntry(entry);
        }
        break;

      case SyncOpKind.upload:
        final file = File(p.join(root, rel));
        if (await file.exists()) {
          final name = p.basename(rel);
          final res = await _api!.uploadFile(
            file: file,
            name: name,
            parentId: 'root',
            hash: op.payload['hash'] as String?,
            baseVersion: op.payload['baseVersion'] as int?,
            replaceNodeId: op.payload['nodeId'] as String?,
          );
          if (op.entryId != null) {
            final entry = (await _db.getAllEntries()).firstWhere((e) => e.entryId == op.entryId);
            entry.nodeId = res['id'] as String;
            entry.baseVersion = res['version'] as int?;
            entry.baseName = res['name'] as String?;
            entry.baseHash = res['hash'] as String?;
            entry.baseSize = res['size'] as int?;
            entry.remoteVersion = entry.baseVersion;
            entry.remoteName = entry.baseName;
            entry.remoteHash = entry.baseHash;
            entry.remoteSize = entry.baseSize;
            await _db.saveEntry(entry);
          }
        }
        break;

      case SyncOpKind.download:
        final nodeId = op.payload['nodeId'] as String;
        final dest = p.join(root, rel);
        await _api!.downloadFile(
          nodeId: nodeId,
          destinationPath: dest,
          expectedHash: op.payload['hash'] as String?,
        );
        if (op.entryId != null) {
          final entry = (await _db.getAllEntries()).firstWhere((e) => e.entryId == op.entryId);
          entry.baseVersion = entry.remoteVersion;
          entry.baseName = entry.remoteName;
          entry.baseHash = entry.remoteHash;
          entry.baseSize = entry.remoteSize;
          entry.localPresent = true;
          entry.localHash = entry.remoteHash;
          await _db.saveEntry(entry);
        }
        break;

      case SyncOpKind.deleteLocal:
        final isDir = op.payload['type'] == 'folder';
        final fPath = p.join(root, rel);
        if (isDir) {
          final dir = Directory(fPath);
          if (await dir.exists()) await dir.delete(recursive: true);
        } else {
          final file = File(fPath);
          if (await file.exists()) await file.delete();
        }
        if (op.entryId != null) {
          await _db.deleteEntry(op.entryId!);
        }
        break;

      case SyncOpKind.deleteRemote:
        final nodeId = op.payload['nodeId'] as String;
        final ver = op.payload['version'] as int?;
        await _api!.deleteNode(nodeId: nodeId, version: ver);
        if (op.entryId != null) {
          await _db.deleteEntry(op.entryId!);
        }
        break;

      case SyncOpKind.moveLocal:
        final toName = op.payload['toName'] as String;
        final oldFile = File(p.join(root, rel));
        final newPath = p.join(oldFile.parent.path, toName);
        if (await oldFile.exists()) {
          await oldFile.rename(newPath);
        }
        if (op.entryId != null) {
          final entry = (await _db.getAllEntries()).firstWhere((e) => e.entryId == op.entryId);
          entry.localRelPath = p.relative(newPath, from: root).replaceAll('\\', '/');
          entry.baseName = toName;
          entry.baseVersion = entry.remoteVersion;
          await _db.saveEntry(entry);
        }
        break;

      case SyncOpKind.adopt:
        if (op.entryId != null) {
          final entry = (await _db.getAllEntries()).firstWhere((e) => e.entryId == op.entryId);
          entry.baseVersion = entry.remoteVersion;
          entry.baseHash = entry.remoteHash;
          entry.baseSize = entry.remoteSize;
          entry.baseName = entry.remoteName;
          await _db.saveEntry(entry);
        }
        break;

      case SyncOpKind.conflict:
        final origRel = op.payload['originalRelPath'] as String;
        final conflictRel = op.payload['conflictRelPath'] as String;
        final origFile = File(p.join(root, origRel));
        final conflictFile = File(p.join(root, conflictRel));

        // 1. Rename local file to conflicted copy
        if (await origFile.exists()) {
          await origFile.rename(conflictFile.path);
        }

        // 2. Download remote file to original path
        final nodeId = op.payload['nodeId'] as String;
        await _api!.downloadFile(
          nodeId: nodeId,
          destinationPath: origFile.path,
          expectedHash: op.payload['remoteHash'] as String?,
        );

        // 3. Upload conflicted copy as a new file
        if (await conflictFile.exists()) {
          await _api!.uploadFile(
            file: conflictFile,
            name: p.basename(conflictRel),
            parentId: 'root',
          );
        }

        // 4. Update state conflicts list
        final currentConflicts = List<String>.from(state.value.conflicts);
        currentConflicts.add(p.basename(conflictRel));
        state.value = state.value.copyWith(conflicts: currentConflicts);

        // 5. Update DB entry base
        if (op.entryId != null) {
          final entry = (await _db.getAllEntries()).firstWhere((e) => e.entryId == op.entryId);
          entry.baseVersion = entry.remoteVersion;
          entry.baseHash = entry.remoteHash;
          entry.baseSize = entry.remoteSize;
          entry.localPresent = true;
          await _db.saveEntry(entry);
        }
        break;

      default:
        break;
    }
  }
}
