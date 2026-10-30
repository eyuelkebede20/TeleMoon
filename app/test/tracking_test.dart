import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:app/sync/models.dart';
import 'package:app/sync/planner.dart';
import 'package:app/sync/sync_db.dart';
import 'package:app/sync/sync_engine.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  group('Selective Folder and File Tracking Tests', () {
    late Directory tempDir;
    late SyncEngine engine;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('telemoon_tracking_test_');
      await SyncDB.instance.clearAll();
      engine = SyncEngine.instance;
      engine.configure(
        baseUrl: 'http://localhost:8080/api',
        token: 'test_token',
        deviceId: 'test_device',
        syncRoot: tempDir,
      );
      await engine.loadTrackingRules();
    });

    tearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('Default mode tracks all paths unless explicitly excluded', () async {
      await engine.trackPath('Documents');
      expect(engine.isTracked('Documents'), isTrue);
      expect(engine.isTracked('Documents/Report.pdf'), isTrue);
      expect(engine.isTracked('Photos/image.png'), isTrue);

      // Untrack / exclude Photos
      await engine.untrackPath('Photos');
      expect(engine.isTracked('Photos'), isFalse);
      expect(engine.isTracked('Photos/image.png'), isFalse);
      expect(engine.isTracked('Documents/Report.pdf'), isTrue);
    });

    test('Toggle tracking switches state correctly', () async {
      await engine.trackPath('Notes');
      expect(engine.isTracked('Notes'), isTrue);

      await engine.toggleTracking('Notes');
      expect(engine.isTracked('Notes'), isFalse);

      await engine.toggleTracking('Notes');
      expect(engine.isTracked('Notes'), isTrue);
    });

    test('Selective sync mode only includes tracked paths and their subpaths', () async {
      await engine.setSelectiveSyncMode(true);
      await engine.trackPath('Work');

      expect(engine.isTracked('Work'), isTrue);
      expect(engine.isTracked('Work/2026/plan.txt'), isTrue);
      // Untracked folders are excluded in selective mode
      expect(engine.isTracked('Personal/diary.txt'), isFalse);

      await engine.setSelectiveSyncMode(false);
    });

    test('Planner ignores excluded/untracked entries', () {
      final entries = [
        SyncEntry(
          nodeId: '1',
          type: 'file',
          remoteName: 'tracked_file.txt',
          remoteHash: 'hash1',
          remoteSize: 100,
          remoteVersion: 1,
          localRelPath: 'tracked_file.txt',
          localPresent: false,
          excluded: false,
        ),
        SyncEntry(
          nodeId: '2',
          type: 'file',
          remoteName: 'untracked_file.txt',
          remoteHash: 'hash2',
          remoteSize: 200,
          remoteVersion: 1,
          localRelPath: 'untracked_file.txt',
          localPresent: false,
          excluded: true, // Untracked / excluded
        ),
      ];

      final ops = Planner.plan(entries);
      // Only the tracked file should produce a download op
      expect(ops.length, equals(1));
      expect(ops.first.kind, equals(SyncOpKind.download));
      expect(ops.first.payload['relPath'], equals('tracked_file.txt'));
    });
  });
}
