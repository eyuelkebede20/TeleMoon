import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);

  @override
  String toString() => message;
}

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  String? _customBaseUrl;
  String? _token;
  Map<String, dynamic>? _user;

  static const String productionBaseUrl = 'https://telemoon.ethiodeploy.com/api';

  String get defaultBaseUrl => productionBaseUrl;

  String get baseUrl {
    if (_customBaseUrl != null && _customBaseUrl!.isNotEmpty) {
      return _customBaseUrl!;
    }
    return defaultBaseUrl;
  }

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('auth_token');
    
    final savedUserStr = prefs.getString('auth_user');
    if (savedUserStr != null) {
      try {
        _user = jsonDecode(savedUserStr);
      } catch (_) {}
    }

    final savedUrl = prefs.getString('server_base_url');
    if (savedUrl != null &&
        (savedUrl.contains('localhost:8080') || savedUrl.contains('10.0.2.2:8080'))) {
      await prefs.remove('server_base_url');
      _customBaseUrl = null;
    } else {
      _customBaseUrl = savedUrl;
    }

    // Try refreshing user in background if authenticated
    if (isAuthenticated) {
      unawaited(fetchMe().catchError((_) => null));
    }
  }

  Future<void> setBaseUrl(String url) async {
    var formatted = url.trim();
    if (formatted.endsWith('/')) {
      formatted = formatted.substring(0, formatted.length - 1);
    }
    if (!formatted.endsWith('/api') && !formatted.contains('/api/')) {
      formatted = '$formatted/api';
    }
    _customBaseUrl = formatted;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_base_url', formatted);
  }

  Future<void> resetBaseUrl() async {
    _customBaseUrl = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('server_base_url');
  }

  Future<void> setToken(String token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('auth_token', token);
  }

  Future<void> setUser(Map<String, dynamic>? user) async {
    _user = user;
    final prefs = await SharedPreferences.getInstance();
    if (user != null) {
      await prefs.setString('auth_user', jsonEncode(user));
    } else {
      await prefs.remove('auth_user');
    }
  }

  Future<void> clearToken() async {
    _token = null;
    _user = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
    await prefs.remove('auth_user');
  }

  bool get isAuthenticated => _token != null;
  String? get token => _token;
  Map<String, dynamic>? get currentUser => _user;
  String? get channelId => _user?['channel_id']?.toString();
  String? get handle => _user?['handle']?.toString();
  bool get hasChannel => channelId != null && channelId!.trim().isNotEmpty;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<Map<String, dynamic>> login(String rawHandle, String password) async {
    final cleanHandle = rawHandle.trim().replaceFirst(RegExp(r'^@'), '').toLowerCase();
    final endpoint = '$baseUrl/auth/enter';
    try {
      final res = await http
          .post(
            Uri.parse(endpoint),
            headers: _headers,
            body: jsonEncode({'handle': cleanHandle, 'password': password}),
          )
          .timeout(const Duration(seconds: 15));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        if (data['token'] != null) {
          await setToken(data['token']);
        }
        if (data['user'] != null && data['user'] is Map) {
          await setUser(Map<String, dynamic>.from(data['user']));
        }
        return data;
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>?> fetchMe() async {
    if (!isAuthenticated) return null;
    final endpoint = '$baseUrl/auth/me';
    try {
      final res = await http
          .get(Uri.parse(endpoint), headers: _headers)
          .timeout(const Duration(seconds: 10));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        if (data['user'] != null && data['user'] is Map) {
          final u = Map<String, dynamic>.from(data['user']);
          await setUser(u);
          return u;
        }
      }
    } catch (_) {}
    return _user;
  }

  Future<Map<String, dynamic>> getStatus() async {
    final endpoint = '$baseUrl/status';
    try {
      final res = await http.get(Uri.parse(endpoint), headers: _headers).timeout(const Duration(seconds: 10));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return jsonDecode(res.body);
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<List<Map<String, dynamic>>> getDialogs() async {
    final endpoint = '$baseUrl/tg/dialogs';
    try {
      final res = await http
          .get(Uri.parse(endpoint), headers: _headers)
          .timeout(const Duration(seconds: 15));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        if (data['dialogs'] is List) {
          return List<Map<String, dynamic>>.from(
            (data['dialogs'] as List).map((x) => Map<String, dynamic>.from(x)),
          );
        }
        return [];
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>> connectLink(String link) async {
    final endpoint = '$baseUrl/tg/connect';
    try {
      final res = await http
          .post(
            Uri.parse(endpoint),
            headers: _headers,
            body: jsonEncode({'link': link}),
          )
          .timeout(const Duration(seconds: 25));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        final cid = data['id']?.toString() ?? link;
        if (_user != null) {
          final updated = Map<String, dynamic>.from(_user!);
          updated['channel_id'] = cid;
          await setUser(updated);
        }
        return data;
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>> setChannel(String channelId) async {
    final endpoint = '$baseUrl/user/channel';
    try {
      final res = await http
          .post(
            Uri.parse(endpoint),
            headers: _headers,
            body: jsonEncode({'channel_id': channelId}),
          )
          .timeout(const Duration(seconds: 15));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        final resolvedId = data['channel_id']?.toString() ?? channelId;
        if (_user != null) {
          final updated = Map<String, dynamic>.from(_user!);
          updated['channel_id'] = resolvedId;
          await setUser(updated);
        }
        return data;
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>> connectOrSetChannel(String input) async {
    final trimmed = input.trim();
    if (trimmed.startsWith('@') ||
        trimmed.startsWith('tg://') ||
        trimmed.contains('t.me') ||
        trimmed.contains('telegram.me') ||
        trimmed.contains('telegram.dog')) {
      return await connectLink(trimmed);
    } else {
      return await setChannel(trimmed);
    }
  }

  /// Origin URL without trailing `/api` for building shareable Drop / Upload links.
  String get originUrl {
    final u = baseUrl;
    if (u.endsWith('/api')) {
      return u.substring(0, u.length - 4);
    }
    return u;
  }

  /// Normalizes a user-pasted small upload key (`4829`, `#qq`, or full `#/d/...` URL).
  static String cleanDropCode(String raw) {
    var clean = raw.trim();
    if (clean.isEmpty) return '';
    clean = clean
        .replaceFirst(RegExp(r'^https?://[^/]+', caseSensitive: false), '')
        .replaceFirst(RegExp(r'^/?#+\/?'), '')
        .replaceFirst(RegExp(r'^/?(d|drop|u)/', caseSensitive: false), '')
        .split('?')[0]
        .split('#')[0]
        .replaceAll(RegExp(r'/+$'), '')
        .replaceFirst(RegExp(r'^#+'), '')
        .trim();
    return clean;
  }

  Future<List<Map<String, dynamic>>> getAllDropLinks() async {
    final endpoint = '$baseUrl/drop-links';
    try {
      final res = await http
          .get(Uri.parse(endpoint), headers: _headers)
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        final list = data['dropLinks'] as List<dynamic>? ?? const [];
        return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<List<Map<String, dynamic>>> getDropLinks(String folderId) async {
    final endpoint = '$baseUrl/folders/${Uri.encodeComponent(folderId)}/drop-links';
    try {
      final res = await http
          .get(Uri.parse(endpoint), headers: _headers)
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        final list = data['dropLinks'] as List<dynamic>? ?? const [];
        return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>> createDropLink(
    String folderId, {
    String? code,
    String? password,
    String? title,
  }) async {
    final endpoint = '$baseUrl/folders/${Uri.encodeComponent(folderId)}/drop-links';
    final body = <String, dynamic>{};
    final cleaned = code != null ? cleanDropCode(code) : '';
    if (cleaned.isNotEmpty) body['code'] = cleaned;
    if (password != null && password.isNotEmpty) body['password'] = password;
    if (title != null && title.trim().isNotEmpty) body['title'] = title.trim();

    try {
      final res = await http
          .post(Uri.parse(endpoint), headers: _headers, body: jsonEncode(body))
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        return Map<String, dynamic>.from(data['dropLink'] as Map);
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>> updateDropLink(
    String id, {
    String? code,
    String? password,
    bool? isActive,
    String? title,
  }) async {
    final endpoint = '$baseUrl/drop-links/${Uri.encodeComponent(id)}';
    final body = <String, dynamic>{};
    if (code != null) {
      final cleaned = cleanDropCode(code);
      if (cleaned.isNotEmpty) body['code'] = cleaned;
    }
    if (password != null) body['password'] = password;
    if (isActive != null) body['is_active'] = isActive;
    if (title != null) body['title'] = title;

    try {
      final res = await http
          .patch(Uri.parse(endpoint), headers: _headers, body: jsonEncode(body))
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        return Map<String, dynamic>.from(data['dropLink'] as Map);
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<void> deleteDropLink(String id) async {
    final endpoint = '$baseUrl/drop-links/${Uri.encodeComponent(id)}';
    try {
      final res = await http
          .delete(Uri.parse(endpoint), headers: _headers)
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return;
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>> getDropInfo(String rawCode) async {
    final clean = cleanDropCode(rawCode);
    if (clean.isEmpty) {
      throw ApiException('Please enter an upload key');
    }
    final endpoint = '$baseUrl/drop/${Uri.encodeComponent(clean)}';
    try {
      final res = await http
          .get(Uri.parse(endpoint), headers: const {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return Map<String, dynamic>.from(jsonDecode(res.body) as Map);
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  Future<Map<String, dynamic>> verifyDropPassword(String rawCode, String password) async {
    final clean = cleanDropCode(rawCode);
    final endpoint = '$baseUrl/drop/${Uri.encodeComponent(clean)}/verify';
    try {
      final res = await http
          .post(
            Uri.parse(endpoint),
            headers: const {'Content-Type': 'application/json', 'Accept': 'application/json'},
            body: jsonEncode({'password': password}),
          )
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return Map<String, dynamic>.from(jsonDecode(res.body) as Map);
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  /// Uploads a local [File] to an active Upload Key destination in streamed chunks.
  Future<Map<String, dynamic>> uploadFileToDrop({
    required String code,
    required String ticket,
    required File file,
    void Function(int sent, int total)? onProgress,
  }) async {
    final bytes = await file.readAsBytes();
    final name = file.uri.pathSegments.isNotEmpty
        ? file.uri.pathSegments.last
        : file.path.split(Platform.pathSeparator).last;
    return uploadBytesToDrop(
      code: code,
      ticket: ticket,
      name: name,
      bytes: bytes,
      clientModifiedAt: file.lastModifiedSync().millisecondsSinceEpoch,
      onProgress: onProgress,
    );
  }

  /// Uploads in-memory bytes to an active Upload Key destination.
  Future<Map<String, dynamic>> uploadBytesToDrop({
    required String code,
    required String ticket,
    required String name,
    required List<int> bytes,
    String? mime,
    int? clientModifiedAt,
    void Function(int sent, int total)? onProgress,
  }) async {
    final clean = cleanDropCode(code);
    final encodedCode = Uri.encodeComponent(clean);
    final totalSize = bytes.length;
    final fullHash = sha256.convert(bytes).toString();

    final initEndpoint = '$baseUrl/drop/$encodedCode/uploads';
    final dropHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Drop-Ticket': ticket,
    };

    try {
      final initRes = await http
          .post(
            Uri.parse(initEndpoint),
            headers: dropHeaders,
            body: jsonEncode({
              'name': name,
              'size': totalSize,
              'mime': ?mime,
              'hash': fullHash,
              'clientModifiedAt': ?clientModifiedAt,
            }),
          )
          .timeout(const Duration(seconds: 30));

      if (initRes.statusCode < 200 || initRes.statusCode >= 300) {
        throw ApiException(_extractError(initRes, initEndpoint));
      }

      final initData = Map<String, dynamic>.from(jsonDecode(initRes.body) as Map);
      if (initData['dedup'] == true) {
        onProgress?.call(totalSize, totalSize);
        return Map<String, dynamic>.from(initData['node'] as Map);
      }

      final uploadId = initData['id'] as String;
      final chunkSize = (initData['chunkSize'] as int?) ?? (1024 * 1024 * 1024);
      final totalParts = totalSize == 0 ? 1 : (totalSize / chunkSize).ceil();
      int sentBytes = 0;

      for (int idx = 0; idx < totalParts; idx++) {
        final start = idx * chunkSize;
        final end = (start + chunkSize > totalSize) ? totalSize : start + chunkSize;
        final slice = totalSize == 0 ? const <int>[] : bytes.sublist(start, end);
        final partHash = sha256.convert(slice).toString();
        final partEndpoint =
            '$baseUrl/drop/$encodedCode/uploads/${Uri.encodeComponent(uploadId)}/parts/$idx';

        final partRes = await http
            .put(
              Uri.parse(partEndpoint),
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-Drop-Ticket': ticket,
                'X-Part-SHA256': partHash,
              },
              body: slice,
            )
            .timeout(const Duration(minutes: 5));

        if (partRes.statusCode < 200 || partRes.statusCode >= 300) {
          throw ApiException(_extractError(partRes, partEndpoint));
        }

        sentBytes += slice.length;
        onProgress?.call(sentBytes, totalSize);
      }

      final compEndpoint =
          '$baseUrl/drop/$encodedCode/uploads/${Uri.encodeComponent(uploadId)}/complete';
      final compRes = await http
          .post(Uri.parse(compEndpoint), headers: dropHeaders)
          .timeout(const Duration(seconds: 30));

      if (compRes.statusCode < 200 || compRes.statusCode >= 300) {
        throw ApiException(_extractError(compRes, compEndpoint));
      }

      final compData = Map<String, dynamic>.from(jsonDecode(compRes.body) as Map);
      return Map<String, dynamic>.from(compData['node'] as Map);
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, initEndpoint));
    }
  }

  Future<Map<String, dynamic>> getChildren(String folderId) async {
    final endpoint = '$baseUrl/nodes/$folderId/children';
    try {
      final res = await http
          .get(
            Uri.parse(endpoint),
            headers: _headers,
          )
          .timeout(const Duration(seconds: 15));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        return jsonDecode(res.body);
      }
      throw ApiException(_extractError(res, endpoint));
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(_formatNetworkError(e, endpoint));
    }
  }

  String _extractError(http.Response res, String endpoint) {
    debugPrint('[ApiService] HTTP ${res.statusCode} at $endpoint: ${res.body}');
    try {
      final decoded = jsonDecode(res.body);
      if (decoded is Map) {
        final err = decoded['error'];
        if (err is Map) {
          final msg = err['message'] ?? err['code'] ?? err.toString();
          return msg.toString();
        } else if (err is String && err.isNotEmpty) {
          return err;
        }
        final msg = decoded['message'];
        if (msg is String && msg.isNotEmpty) {
          return msg;
        }
      }
    } catch (_) {}

    final cleanBody = res.body.replaceAll(RegExp(r'<[^>]*>'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    if (cleanBody.isNotEmpty && cleanBody.length <= 140) {
      return cleanBody;
    }
    return res.reasonPhrase ?? 'Request failed (${res.statusCode})';
  }

  String _formatNetworkError(Object error, String endpoint) {
    final errStr = error.toString().replaceFirst('Exception: ', '');
    debugPrint('[ApiService] Network error at $endpoint: $errStr');
    if (errStr.contains('Connection refused') || errStr.contains('SocketException')) {
      return 'Cannot reach TeleMoon backend. Is the server running?';
    }
    if (errStr.contains('Failed host lookup') || errStr.contains('No address associated with hostname')) {
      return 'Cannot resolve server host. Please check your network connection.';
    }
    if (errStr.contains('TimeoutException') || errStr.contains('timed out')) {
      return 'Connection timed out after 15s.';
    }
    return errStr;
  }
}
