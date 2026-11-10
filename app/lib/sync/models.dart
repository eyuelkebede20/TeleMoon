enum SyncOpKind {
  upload,
  download,
  mkdirLocal,
  mkdirRemote,
  moveLocal,
  moveRemote,
  deleteLocal,
  deleteRemote,
  adopt,
  conflict,
}

class SyncOp {
  final int? opId;
  final int? entryId;
  final SyncOpKind kind;
  final Map<String, dynamic> payload;
  final String idempotencyKey;

  SyncOp({
    this.opId,
    this.entryId,
    required this.kind,
    required this.payload,
    required this.idempotencyKey,
  });

  Map<String, dynamic> toMap() => {
    if (opId != null) 'op_id': opId,
    'entry_id': entryId ?? 0,
    'kind': kind.name.toUpperCase(),
    'payload': payload,
    'idempotency_key': idempotencyKey,
  };

  @override
  String toString() => 'SyncOp($kind, payload: $payload)';
}

class SyncEntry {
  int? entryId;
  String? nodeId;
  String type; // 'file' | 'folder'

  // Base state (last agreed state)
  String? baseParentId;
  String? baseName;
  int? baseVersion;
  String? baseHash;
  int? baseSize;

  // Remote state
  String? remoteParentId;
  String? remoteName;
  int? remoteVersion;
  String? remoteHash;
  int? remoteSize;
  bool remoteDeleted;

  // Local state
  String? localRelPath;
  String? localFileId;
  int? localSize;
  int? localMtimeNs;
  String? localHash;
  bool localPresent;

  bool excluded;
  String status; // 'synced', 'pending', 'conflict', 'error'
  String? statusDetail;

  SyncEntry({
    this.entryId,
    this.nodeId,
    required this.type,
    this.baseParentId,
    this.baseName,
    this.baseVersion,
    this.baseHash,
    this.baseSize,
    this.remoteParentId,
    this.remoteName,
    this.remoteVersion,
    this.remoteHash,
    this.remoteSize,
    this.remoteDeleted = false,
    this.localRelPath,
    this.localFileId,
    this.localSize,
    this.localMtimeNs,
    this.localHash,
    this.localPresent = false,
    this.excluded = false,
    this.status = 'synced',
    this.statusDetail,
  });

  bool get hasBase => baseVersion != null || baseName != null;
  bool get isFile => type == 'file';
  bool get isFolder => type == 'folder';

  Map<String, dynamic> toMap() => {
    if (entryId != null) 'entry_id': entryId,
    'node_id': nodeId,
    'type': type,
    'base_parent_id': baseParentId,
    'base_name': baseName,
    'base_version': baseVersion,
    'base_hash': baseHash,
    'base_size': baseSize,
    'remote_parent_id': remoteParentId,
    'remote_name': remoteName,
    'remote_version': remoteVersion,
    'remote_hash': remoteHash,
    'remote_size': remoteSize,
    'remote_deleted': remoteDeleted ? 1 : 0,
    'local_rel_path': localRelPath,
    'local_file_id': localFileId,
    'local_size': localSize,
    'local_mtime_ns': localMtimeNs,
    'local_hash': localHash,
    'local_present': localPresent ? 1 : 0,
    'excluded': excluded ? 1 : 0,
    'status': status,
    'status_detail': statusDetail,
  };

  factory SyncEntry.fromMap(Map<String, dynamic> m) {
    return SyncEntry(
      entryId: m['entry_id'] as int?,
      nodeId: m['node_id'] as String?,
      type: m['type'] as String,
      baseParentId: m['base_parent_id'] as String?,
      baseName: m['base_name'] as String?,
      baseVersion: m['base_version'] as int?,
      baseHash: m['base_hash'] as String?,
      baseSize: m['base_size'] as int?,
      remoteParentId: m['remote_parent_id'] as String?,
      remoteName: m['remote_name'] as String?,
      remoteVersion: m['remote_version'] as int?,
      remoteHash: m['remote_hash'] as String?,
      remoteSize: m['remote_size'] as int?,
      remoteDeleted: (m['remote_deleted'] as int? ?? 0) == 1,
      localRelPath: m['local_rel_path'] as String?,
      localFileId: m['local_file_id'] as String?,
      localSize: m['local_size'] as int?,
      localMtimeNs: m['local_mtime_ns'] as int?,
      localHash: m['local_hash'] as String?,
      localPresent: (m['local_present'] as int? ?? 0) == 1,
      excluded: (m['excluded'] as int? ?? 0) == 1,
      status: m['status'] as String? ?? 'synced',
      statusDetail: m['status_detail'] as String?,
    );
  }
}
