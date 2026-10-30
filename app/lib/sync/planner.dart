import 'models.dart';

class Planner {
  /// Pure reconciliation function: (Local, Base, Remote) => `List<SyncOp>`
  static List<SyncOp> plan(
    List<SyncEntry> entries, {
    String deviceName = 'Desktop',
    DateTime? now,
  }) {
    final currentTime = now ?? DateTime.now();
    final dateStr =
        '${currentTime.year}-${currentTime.month.toString().padLeft(2, '0')}-${currentTime.day.toString().padLeft(2, '0')}';

    final moves = <SyncOp>[];
    final folderCreates = <SyncOp>[];
    final transfers = <SyncOp>[];
    final deletes = <SyncOp>[];

    for (final e in entries) {
      if (e.excluded) continue;

      if (e.isFolder) {
        _planFolder(e, folderCreates, deletes, moves);
      } else {
        _planFile(e, moves, transfers, deletes, deviceName, dateStr);
      }
    }

    // Ordering:
    // 1. Moves first
    // 2. Folder creates (parents before children)
    // 3. File transfers (uploads/downloads)
    // 4. Deletes (children before parents)
    folderCreates.sort((a, b) {
      final pA = (a.payload['path'] as String? ?? '').split('/').length;
      final pB = (b.payload['path'] as String? ?? '').split('/').length;
      return pA.compareTo(pB);
    });

    deletes.sort((a, b) {
      final pA = (a.payload['path'] as String? ?? '').split('/').length;
      final pB = (b.payload['path'] as String? ?? '').split('/').length;
      return pB.compareTo(pA); // deeper children first
    });

    return [
      ...moves,
      ...folderCreates,
      ...transfers,
      ...deletes,
    ];
  }

  static void _planFolder(
    SyncEntry e,
    List<SyncOp> folderCreates,
    List<SyncOp> deletes,
    List<SyncOp> moves,
  ) {
    final localPresent = e.localPresent;
    final remotePresent = e.nodeId != null && !e.remoteDeleted;

    if (e.hasBase) {
      // Check for remote rename/move
      if (remotePresent && e.remoteName != null && e.baseName != null && e.remoteName != e.baseName) {
        moves.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.moveLocal,
          payload: {
            'nodeId': e.nodeId,
            'fromName': e.baseName,
            'toName': e.remoteName,
            'relPath': e.localRelPath,
          },
          idempotencyKey: 'mov_loc_${e.nodeId}_${e.remoteVersion}',
        ));
      }

      if (localPresent && !remotePresent) {
        // Remote folder was deleted
        deletes.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.deleteLocal,
          payload: {'relPath': e.localRelPath, 'type': 'folder'},
          idempotencyKey: 'del_loc_${e.nodeId}',
        ));
      } else if (!localPresent && remotePresent) {
        // Local folder was deleted
        deletes.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.deleteRemote,
          payload: {'nodeId': e.nodeId, 'version': e.baseVersion},
          idempotencyKey: 'del_rem_${e.nodeId}_${e.baseVersion}',
        ));
      }
    } else {
      // No base exists
      if (localPresent && !remotePresent) {
        folderCreates.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.mkdirRemote,
          payload: {
            'parentId': e.remoteParentId ?? 'root',
            'name': e.localRelPath?.split('/').last ?? 'folder',
            'relPath': e.localRelPath,
          },
          idempotencyKey: 'mk_rem_${e.localRelPath}',
        ));
      } else if (!localPresent && remotePresent) {
        folderCreates.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.mkdirLocal,
          payload: {
            'nodeId': e.nodeId,
            'relPath': e.localRelPath ?? e.remoteName,
            'path': e.localRelPath ?? e.remoteName,
          },
          idempotencyKey: 'mk_loc_${e.nodeId}',
        ));
      }
    }
  }

  static void _planFile(
    SyncEntry e,
    List<SyncOp> moves,
    List<SyncOp> transfers,
    List<SyncOp> deletes,
    String deviceName,
    String dateStr,
  ) {
    final localPresent = e.localPresent;
    final remotePresent = e.nodeId != null && !e.remoteDeleted;

    final localModified = localPresent &&
        (e.baseHash == null || e.localHash != e.baseHash || e.localSize != e.baseSize);
    final remoteModified = remotePresent &&
        (e.baseVersion == null || (e.remoteVersion != null && e.remoteVersion! > (e.baseVersion ?? 0)));

    final localDeleted = e.hasBase && !localPresent;
    final remoteDeleted = e.hasBase && (e.remoteDeleted || e.nodeId == null);

    if (e.hasBase) {
      // 1. Both unchanged
      if (!localModified && !remoteModified && !localDeleted && !remoteDeleted) {
        return; // In sync
      }

      // 2. Local modified, remote unchanged
      if (localModified && !remoteModified && !remoteDeleted) {
        transfers.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.upload,
          payload: {
            'replaceNodeId': e.nodeId,
            'baseVersion': e.baseVersion,
            'relPath': e.localRelPath,
            'size': e.localSize,
            'hash': e.localHash,
          },
          idempotencyKey: 'up_${e.nodeId}_${e.localHash}',
        ));
        return;
      }

      // 3. Local unchanged, remote modified
      if (!localModified && !localDeleted && remoteModified) {
        transfers.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.download,
          payload: {
            'nodeId': e.nodeId,
            'version': e.remoteVersion,
            'relPath': e.localRelPath,
            'expectedHash': e.remoteHash,
            'size': e.remoteSize,
          },
          idempotencyKey: 'dl_${e.nodeId}_${e.remoteVersion}',
        ));
        return;
      }

      // 4. Local deleted, remote unchanged
      if (localDeleted && !remoteModified && !remoteDeleted) {
        deletes.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.deleteRemote,
          payload: {'nodeId': e.nodeId, 'baseVersion': e.baseVersion},
          idempotencyKey: 'del_rem_${e.nodeId}_${e.baseVersion}',
        ));
        return;
      }

      // 5. Local unchanged, remote deleted
      if (!localModified && !localDeleted && remoteDeleted) {
        deletes.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.deleteLocal,
          payload: {'relPath': e.localRelPath, 'type': 'file'},
          idempotencyKey: 'del_loc_${e.nodeId}',
        ));
        return;
      }

      // 6. Both modified -> Conflict or Adopt
      if (localModified && remoteModified) {
        if (e.localHash != null && e.remoteHash != null && e.localHash == e.remoteHash) {
          // Hashes match: adopt remote version without transfer
          transfers.add(SyncOp(
            entryId: e.entryId,
            kind: SyncOpKind.adopt,
            payload: {
              'nodeId': e.nodeId,
              'version': e.remoteVersion,
              'hash': e.remoteHash,
            },
            idempotencyKey: 'adopt_${e.nodeId}_${e.remoteVersion}',
          ));
        } else {
          // True conflict!
          _emitConflictOps(e, transfers, deviceName, dateStr);
        }
        return;
      }

      // 7. Both deleted
      if (localDeleted && remoteDeleted) {
        return; // Already deleted on both sides
      }

      // 8. Edit beats delete: local modified, remote deleted -> re-upload local
      if (localModified && remoteDeleted) {
        transfers.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.upload,
          payload: {
            'replaceNodeId': null,
            'parentId': e.remoteParentId ?? 'root',
            'relPath': e.localRelPath,
            'size': e.localSize,
            'hash': e.localHash,
            'name': e.localRelPath?.split('/').last,
          },
          idempotencyKey: 'resurrect_${e.localRelPath}_${e.localHash}',
        ));
        return;
      }

      // 9. Edit beats delete: local deleted, remote modified -> re-download remote
      if (localDeleted && remoteModified) {
        transfers.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.download,
          payload: {
            'nodeId': e.nodeId,
            'version': e.remoteVersion,
            'relPath': e.localRelPath ?? e.remoteName,
            'expectedHash': e.remoteHash,
            'size': e.remoteSize,
          },
          idempotencyKey: 'dl_resurrect_${e.nodeId}_${e.remoteVersion}',
        ));
        return;
      }
    } else {
      // No base entry exists
      if (localPresent && !remotePresent) {
        // Local new file -> upload
        transfers.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.upload,
          payload: {
            'parentId': e.remoteParentId ?? 'root',
            'relPath': e.localRelPath,
            'name': e.localRelPath?.split('/').last,
            'size': e.localSize,
            'hash': e.localHash,
          },
          idempotencyKey: 'new_up_${e.localRelPath}_${e.localHash}',
        ));
      } else if (!localPresent && remotePresent) {
        // Remote new file -> download
        transfers.add(SyncOp(
          entryId: e.entryId,
          kind: SyncOpKind.download,
          payload: {
            'nodeId': e.nodeId,
            'version': e.remoteVersion,
            'relPath': e.localRelPath ?? e.remoteName,
            'expectedHash': e.remoteHash,
            'size': e.remoteSize,
          },
          idempotencyKey: 'new_dl_${e.nodeId}_${e.remoteVersion}',
        ));
      } else if (localPresent && remotePresent) {
        // Both present without base (collision)
        if (e.localHash != null && e.remoteHash != null && e.localHash == e.remoteHash) {
          transfers.add(SyncOp(
            entryId: e.entryId,
            kind: SyncOpKind.adopt,
            payload: {
              'nodeId': e.nodeId,
              'version': e.remoteVersion,
              'hash': e.remoteHash,
            },
            idempotencyKey: 'adopt_${e.nodeId}_${e.remoteVersion}',
          ));
        } else {
          _emitConflictOps(e, transfers, deviceName, dateStr);
        }
      }
    }
  }

  static void _emitConflictOps(
    SyncEntry e,
    List<SyncOp> transfers,
    String deviceName,
    String dateStr,
  ) {
    final origRelPath = e.localRelPath ?? e.remoteName ?? 'file';
    final dotIdx = origRelPath.lastIndexOf('.');
    final base = dotIdx > 0 ? origRelPath.substring(0, dotIdx) : origRelPath;
    final ext = dotIdx > 0 ? origRelPath.substring(dotIdx) : '';
    final conflictRelPath = '$base ($deviceName conflicted copy $dateStr)$ext';

    transfers.add(SyncOp(
      entryId: e.entryId,
      kind: SyncOpKind.conflict,
      payload: {
        'nodeId': e.nodeId,
        'origRelPath': origRelPath,
        'conflictRelPath': conflictRelPath,
        'remoteVersion': e.remoteVersion,
        'expectedHash': e.remoteHash,
        'remoteSize': e.remoteSize,
        'localSize': e.localSize,
        'localHash': e.localHash,
      },
      idempotencyKey: 'conf_${e.nodeId ?? origRelPath}_${e.remoteVersion}',
    ));
  }
}
