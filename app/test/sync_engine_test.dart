import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:app/sync/models.dart';
import 'package:app/sync/scanner.dart';
import 'package:app/sync/sync_db.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  group('Sync LocalScanner Tests', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('telemoon_scan_test_');
    });

    tearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('Scans regular files and ignores temp/hidden/lock files', () async {
      // Create valid file
      final file1 = File('${tempDir.path}/hello.txt');
      await file1.writeAsString('Hello TeleMoon');

      // Create valid subfolder and file
      final subDir = Directory('${tempDir.path}/sub');
      await subDir.create();
      final file2 = File('${subDir.path}/notes.md');
      await file2.writeAsString('Notes content');

      // Create ignored files
      final tmpFile = File('${tempDir.path}/cache.tmp');
      await tmpFile.writeAsString('ignore me');

      final officeLock = File('${tempDir.path}/~\$Doc.docx');
      await officeLock.writeAsString('lock');

      final gitDir = Directory('${tempDir.path}/.git');
      await gitDir.create();
      final gitFile = File('${gitDir.path}/config');
      await gitFile.writeAsString('git');

      final scanned = await LocalScanner.scan(tempDir);

      expect(scanned.containsKey('hello.txt'), isTrue);
      expect(scanned.containsKey('sub'), isTrue);
      expect(scanned.containsKey('sub/notes.md'), isTrue);

      // Verify ignored files are absent
      expect(scanned.containsKey('cache.tmp'), isFalse);
      expect(scanned.containsKey('~\$Doc.docx'), isFalse);
      expect(scanned.containsKey('.git'), isFalse);
      expect(scanned.containsKey('.git/config'), isFalse);

      // Verify SHA-256 hash was generated
      expect(scanned['hello.txt']!.hash, isNotNull);
      expect(scanned['hello.txt']!.hash!.length, 64);
    });
  });

  group('SyncDB CRUD Tests', () {
    test('Can save, retrieve, and update sync entries via SyncDB', () async {
      final db = SyncDB.instance;
      final entry = SyncEntry(
        nodeId: 'node-202',
        type: 'file',
        localRelPath: 'Documents/Specs.pdf',
        localPresent: true,
        localSize: 2048,
      );

      final id = await db.saveEntry(entry);
      expect(id, isPositive);

      final fetched = await db.getEntryByNodeId('node-202');
      expect(fetched, isNotNull);
      expect(fetched!.localRelPath, 'Documents/Specs.pdf');

      await db.setKv('last_cursor', '42');
      final cursor = await db.getKv('last_cursor');
      expect(cursor, '42');
    });
  });
}
