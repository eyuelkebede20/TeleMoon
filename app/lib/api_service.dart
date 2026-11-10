import 'dart:async';
import 'dart:convert';
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
        if (_user != null) {
          final updated = Map<String, dynamic>.from(_user!);
          updated['channel_id'] = channelId;
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
        trimmed.contains('t.me') ||
        trimmed.contains('telegram.me')) {
      return await connectLink(trimmed);
    } else {
      return await setChannel(trimmed);
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
