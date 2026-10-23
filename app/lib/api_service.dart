import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  String get baseUrl {
    if (kIsWeb) return 'http://localhost:8080/api';
    if (Platform.isAndroid) return 'http://10.0.2.2:8080/api';
    return 'http://localhost:8080/api';
  }

  String? _token;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('auth_token');
  }

  Future<void> setToken(String token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('auth_token', token);
  }

  Future<void> clearToken() async {
    _token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
  }

  bool get isAuthenticated => _token != null;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<Map<String, dynamic>> login(String handle, String password) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/enter'),
      headers: _headers,
      body: jsonEncode({'handle': handle, 'password': password}),
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      final data = jsonDecode(res.body);
      if (data['token'] != null) {
        await setToken(data['token']);
      }
      return data;
    }
    throw Exception(_extractError(res.body));
  }

  Future<Map<String, dynamic>> connectLink(String link) async {
    final res = await http.post(
      Uri.parse('$baseUrl/tg/connect'),
      headers: _headers,
      body: jsonEncode({'link': link}),
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body);
    }
    throw Exception(_extractError(res.body));
  }

  Future<Map<String, dynamic>> setChannel(String channelId) async {
    final res = await http.post(
      Uri.parse('$baseUrl/user/channel'),
      headers: _headers,
      body: jsonEncode({'channel_id': channelId}),
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body);
    }
    throw Exception(_extractError(res.body));
  }

  Future<Map<String, dynamic>> getChildren(String folderId) async {
    final res = await http.get(
      Uri.parse('$baseUrl/nodes/$folderId/children'),
      headers: _headers,
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body);
    }
    throw Exception(_extractError(res.body));
  }

  String _extractError(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded['error'] ?? 'Unknown error';
    } catch (_) {
      return 'Server error';
    }
  }
}
