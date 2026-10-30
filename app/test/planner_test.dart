import 'package:flutter_test/flutter_test.dart';
import 'package:app/sync/models.dart';
import 'package:app/sync/planner.dart';

void main() {
  group('Planner Decision Matrix Tests', () {
    test('Unchanged file produces no ops', () {
      final entry = SyncEntry(
        entryId: 1,
        nodeId: 'node-1',
        type: 'file',
        baseVersion: 1,
        baseHash: 'hash-a',
        baseSize: 100,
        remoteVersion: 1,
        remoteHash: 'hash-a',
        remoteSize: 100,
        localPresent: true,
        localHash: 'hash-a',
        localSize: 100,
      );

      final ops = Planner.plan([entry]);
      expect(ops, isEmpty);
    });

    test('Local edit produces upload op', () {
      final entry = SyncEntry(
        entryId: 2,
        nodeId: 'node-2',
        type: 'file',
        baseVersion: 1,
        baseHash: 'hash-old',
        baseSize: 100,
        remoteVersion: 1,
        remoteHash: 'hash-old',
        remoteSize: 100,
        localPresent: true,
        localHash: 'hash-new',
        localSize: 120,
        localRelPath: 'Docs/notes.txt',
      );

      final ops = Planner.plan([entry]);
      expect(ops.length, 1);
      expect(ops.first.kind, SyncOpKind.upload);
      expect(ops.first.payload['baseVersion'], 1);
      expect(ops.first.payload['hash'], 'hash-new');
    });

    test('Remote edit produces download op', () {
      final entry = SyncEntry(
        entryId: 3,
        nodeId: 'node-3',
        type: 'file',
        baseVersion: 1,
        baseHash: 'hash-a',
        baseSize: 100,
        remoteVersion: 2,
        remoteHash: 'hash-b',
        remoteSize: 150,
        localPresent: true,
        localHash: 'hash-a',
        localSize: 100,
        localRelPath: 'Docs/readme.txt',
      );

      final ops = Planner.plan([entry]);
      expect(ops.length, 1);
      expect(ops.first.kind, SyncOpKind.download);
      expect(ops.first.payload['version'], 2);
    });

    test('Simultaneous modifications with different hashes produce conflict op', () {
      final entry = SyncEntry(
        entryId: 4,
        nodeId: 'node-4',
        type: 'file',
        baseVersion: 1,
        baseHash: 'hash-orig',
        baseSize: 100,
        remoteVersion: 2,
        remoteHash: 'hash-remote',
        remoteSize: 110,
        localPresent: true,
        localHash: 'hash-local',
        localSize: 120,
        localRelPath: 'Report.docx',
      );

      final ops = Planner.plan([entry], deviceName: 'WindowsPC', now: DateTime(2026, 10, 24));
      expect(ops.length, 1);
      expect(ops.first.kind, SyncOpKind.conflict);
      expect(ops.first.payload['conflictRelPath'], contains('Report (WindowsPC conflicted copy 2026-10-24).docx'));
    });

    test('Simultaneous modifications with identical hashes adopt without conflict', () {
      final entry = SyncEntry(
        entryId: 5,
        nodeId: 'node-5',
        type: 'file',
        baseVersion: 1,
        baseHash: 'hash-orig',
        remoteVersion: 2,
        remoteHash: 'hash-same',
        localPresent: true,
        localHash: 'hash-same',
        localRelPath: 'data.json',
      );

      final ops = Planner.plan([entry]);
      expect(ops.length, 1);
      expect(ops.first.kind, SyncOpKind.adopt);
    });

    test('Local edit vs remote delete (Edit beats delete) re-uploads local', () {
      final entry = SyncEntry(
        entryId: 6,
        nodeId: 'node-6',
        type: 'file',
        baseVersion: 1,
        baseHash: 'hash-old',
        remoteDeleted: true,
        localPresent: true,
        localHash: 'hash-edited',
        localSize: 200,
        localRelPath: 'Important.txt',
      );

      final ops = Planner.plan([entry]);
      expect(ops.length, 1);
      expect(ops.first.kind, SyncOpKind.upload);
      expect(ops.first.payload['replaceNodeId'], isNull); // New node / resurrected
    });
  });
}
