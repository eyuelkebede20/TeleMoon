import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

class SyncApiClient {
  final String baseUrl;
  final String token;
  final String deviceId;

  SyncApiClient({
    required this.baseUrl,
    required this.token,
    required this.deviceId,
  });

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

  Future<Map<String, dynamic>> fetchDelta({required int cursor, int limit = 100}) async {
    final uri = Uri.parse('$baseUrl/sync/delta?cursor=$cursor&limit=$limit');
    final res = await http.get(uri, headers: _headers);
    if (res.statusCode == 410) {
      throw const ResyncRequiredException();
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw Exception('fetchDelta failed [${res.statusCode}]: ${res.body}');
  }

  Future<Map<String, dynamic>> fetchSnapshot({String? after, int limit = 200}) async {
    final query = after != null ? '?after=$after&limit=$limit' : '?limit=$limit';
    final uri = Uri.parse('$baseUrl/sync/snapshot$query');
    final res = await http.get(uri, headers: _headers);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw Exception('fetchSnapshot failed [${res.statusCode}]: ${res.body}');
  }

  Future<Map<String, dynamic>> createFolder({
    required String parentId,
    required String name,
  }) async {
    final uri = Uri.parse('$baseUrl/folders');
    final res = await http.post(
      uri,
      headers: _headers,
      body: jsonEncode({'parentId': parentId, 'name': name}),
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw Exception('createFolder failed [${res.statusCode}]: ${res.body}');
  }

  Future<void> deleteNode({
    required String nodeId,
    int? version,
  }) async {
    final uri = Uri.parse('$baseUrl/nodes/$nodeId');
    final headers = {
      ..._headers,
      if (version != null) 'If-Match': version.toString(),
    };
    final res = await http.delete(uri, headers: headers);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return;
    }
    if (res.statusCode == 404) return; // Already gone
    throw Exception('deleteNode failed [${res.statusCode}]: ${res.body}');
  }

  Future<Map<String, dynamic>> moveOrRenameNode({
    required String nodeId,
    String? name,
    String? parentId,
    int? version,
  }) async {
    final uri = Uri.parse('$baseUrl/nodes/$nodeId');
    final headers = {
      ..._headers,
      if (version != null) 'If-Match': version.toString(),
    };
    final body = <String, dynamic>{};
    if (name != null) body['name'] = name;
    if (parentId != null) body['parentId'] = parentId;

    final res = await http.patch(uri, headers: headers, body: jsonEncode(body));
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw Exception('moveOrRenameNode failed [${res.statusCode}]: ${res.body}');
  }

  Future<Map<String, dynamic>> uploadFile({
    required File file,
    required String name,
    required String parentId,
    String? hash,
    int? baseVersion,
    String? replaceNodeId,
    Function(int bytesSent, int totalBytes)? onProgress,
  }) async {
    final length = await file.length();
    final clientModifiedAt = (await file.lastModified()).millisecondsSinceEpoch;

    // Step 1: Prepare upload
    final prepUri = Uri.parse('$baseUrl/uploads/prepare');
    final prepRes = await http.post(
      prepUri,
      headers: _headers,
      body: jsonEncode({
        'name': name,
        'size': length,
        'parentId': parentId,
        'hash': hash,
        'clientModifiedAt': clientModifiedAt,
        'deviceId': deviceId,
        'replaceNodeId': replaceNodeId,
        'baseVersion': baseVersion,
        'onNameConflict': 'fail',
      }),
    );

    if (prepRes.statusCode != 200) {
      throw Exception('upload prepare failed [${prepRes.statusCode}]: ${prepRes.body}');
    }

    final prepData = jsonDecode(prepRes.body) as Map<String, dynamic>;
    if (prepData['dedup'] == true) {
      return prepData['node'] as Map<String, dynamic>;
    }

    final uploadId = prepData['uploadId'] as String;
    final chunkSize = prepData['chunkSize'] as int;

    // Step 2: Upload parts
    final raf = await file.open(mode: FileMode.read);
    int sent = 0;
    int partIdx = 0;

    try {
      while (sent < length || (length == 0 && partIdx == 0)) {
        final remaining = length - sent;
        final currentChunk = remaining > chunkSize ? chunkSize : remaining;
        final bytes = await raf.read(currentChunk);

        final partHash = sha256.convert(bytes).toString();
        final partUri = Uri.parse('$baseUrl/uploads/$uploadId/parts/$partIdx');

        final partRes = await http.put(
          partUri,
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/octet-stream',
            'X-Part-SHA256': partHash,
          },
          body: bytes,
        );

        if (partRes.statusCode < 200 || partRes.statusCode >= 300) {
          throw Exception('Upload part $partIdx failed [${partRes.statusCode}]: ${partRes.body}');
        }

        sent += bytes.length;
        onProgress?.call(sent, length);
        partIdx++;

        if (length == 0) break; // empty file
      }
    } finally {
      await raf.close();
    }

    // Step 3: Complete upload
    final compUri = Uri.parse('$baseUrl/uploads/$uploadId/complete');
    final compRes = await http.post(compUri, headers: _headers);
    if (compRes.statusCode >= 200 && compRes.statusCode < 300) {
      return jsonDecode(compRes.body) as Map<String, dynamic>;
    }
    throw Exception('Upload complete failed [${compRes.statusCode}]: ${compRes.body}');
  }

  Future<void> downloadFile({
    required String nodeId,
    required String destinationPath,
    String? expectedHash,
    Function(int bytesRead, int totalBytes)? onProgress,
  }) async {
    final destFile = File(destinationPath);
    final tempDir = Directory(p.join(destFile.parent.path, '.telemoon-tmp'));
    if (!await tempDir.exists()) {
      await tempDir.create(recursive: true);
    }

    final tempFile = File(p.join(tempDir.path, '${p.basename(destinationPath)}_${DateTime.now().millisecondsSinceEpoch}.tmp'));

    final uri = Uri.parse('$baseUrl/files/$nodeId/content');
    final request = http.Request('GET', uri);
    request.headers.addAll(_headers);

    final response = await request.send();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Download failed [${response.statusCode}]');
    }

    final sink = tempFile.openWrite();
    int received = 0;
    final total = response.contentLength ?? 0;

    try {
      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        onProgress?.call(received, total);
      }
      await sink.flush();
    } finally {
      await sink.close();
    }

    // Verify SHA-256 if expected
    if (expectedHash != null) {
      final digest = await sha256.bind(tempFile.openRead()).first;
      if (digest.toString().toLowerCase() != expectedHash.toLowerCase()) {
        await tempFile.delete();
        throw Exception('Download SHA-256 hash mismatch! expected: $expectedHash got: $digest');
      }
    }

    // Atomic move to destination
    if (await destFile.exists()) {
      await destFile.delete();
    }
    await tempFile.rename(destinationPath);
  }
}

class ResyncRequiredException implements Exception {
  const ResyncRequiredException();
  @override
  String toString() => 'ResyncRequiredException: Server journal retention expired, full snapshot required.';
}
