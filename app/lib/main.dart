import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'database_helper.dart';
import 'api_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiService().init();
  runApp(const TeleMoonApp());
}

class TeleMoonApp extends StatelessWidget {
  const TeleMoonApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TeleMoon',
      theme: _buildTeleMoonTheme(),
      home: ApiService().isAuthenticated ? const LinkStorageScreen() : const AuthScreen(),
    );
  }

  ThemeData _buildTeleMoonTheme() {
    const Color ink = Color(0xFF0E1220);
    const Color ink2 = Color(0xFF121730);
    const Color panel = Color(0xFF171C30);
    const Color panel2 = Color(0xFF1D2340);
    const Color line = Color(0xFF262D4A);
    const Color moon = Color(0xFFF0D9A8);
    const Color moonDeep = Color(0xFFC9A96A);
    const Color text = Color(0xFFE9ECFA);
    const Color muted = Color(0xFF9099BE);
    const Color sky = Color(0xFF8FB4FF);
    const Color danger = Color(0xFFEE8F8F);

    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: ink,
      colorScheme: const ColorScheme.dark(
        primary: moon,
        secondary: sky,
        surface: panel,
        background: ink,
        error: danger,
        onPrimary: Color(0xFF241D0E),
        onSurface: text,
      ),
      textTheme: TextTheme(
        headlineLarge: GoogleFonts.spaceGrotesk(color: text, fontWeight: FontWeight.w700, letterSpacing: -0.5),
        headlineMedium: GoogleFonts.spaceGrotesk(color: text, fontWeight: FontWeight.w700),
        titleLarge: GoogleFonts.spaceGrotesk(color: text, fontWeight: FontWeight.w700),
        bodyLarge: GoogleFonts.spaceGrotesk(color: text),
        bodyMedium: GoogleFonts.spaceGrotesk(color: text),
        labelLarge: GoogleFonts.spaceGrotesk(color: const Color(0xFF241D0E), fontWeight: FontWeight.w600),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ink2,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: line)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: line)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: moonDeep, width: 2)),
        hintStyle: GoogleFonts.spaceGrotesk(color: muted),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: moon,
          foregroundColor: const Color(0xFF241D0E),
          textStyle: GoogleFonts.spaceGrotesk(fontWeight: FontWeight.w600, fontSize: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------
// AUTH SCREEN
// ---------------------------------------------------------
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _handleController = TextEditingController();
  final _passController = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _login() async {
    setState(() { _loading = true; _error = null; });
    try {
      await ApiService().login(_handleController.text, _passController.text);
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LinkStorageScreen()));
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 400),
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 34),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1D2340), Color(0xFF171C30)],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFF262D4A)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.nightlight_round, color: Color(0xFFF0D9A8), size: 28),
                    const SizedBox(width: 10),
                    Text('TeleMoon', style: theme.textTheme.headlineMedium),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Reading the sky...',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF9099BE)),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _handleController,
                  decoration: const InputDecoration(hintText: '@handle', prefixText: '@ ', prefixStyle: TextStyle(color: Color(0xFFF0D9A8), fontWeight: FontWeight.bold)),
                  style: GoogleFonts.jetbrainsMono(fontSize: 14),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _passController,
                  obscureText: true,
                  decoration: const InputDecoration(hintText: 'Password'),
                  style: GoogleFonts.jetbrainsMono(fontSize: 14),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Color(0xFFEE8F8F), fontSize: 13), textAlign: TextAlign.center),
                ],
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: _loading ? null : _login,
                  child: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF241D0E))) : const Text('Enter'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------
// LINK STORAGE SCREEN
// ---------------------------------------------------------
class LinkStorageScreen extends StatefulWidget {
  const LinkStorageScreen({super.key});

  @override
  State<LinkStorageScreen> createState() => _LinkStorageScreenState();
}

class _LinkStorageScreenState extends State<LinkStorageScreen> {
  final _linkController = TextEditingController();
  final _nameController = TextEditingController();
  List<Map<String, dynamic>> _channels = [];
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadChannels();
  }

  Future<void> _loadChannels() async {
    final data = await DatabaseHelper.instance.queryAllChannels();
    setState(() => _channels = data);
  }

  Future<void> _connect() async {
    if (_linkController.text.isEmpty || _nameController.text.isEmpty) return;
    setState(() { _loading = true; _error = null; });
    try {
      // Connect on backend
      await ApiService().setChannel(_linkController.text);
      // Save locally
      await DatabaseHelper.instance.insertChannel({
        DatabaseHelper.columnName: _nameController.text,
        DatabaseHelper.columnLink: _linkController.text,
      });
      _linkController.clear();
      _nameController.clear();
      await _loadChannels();
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _selectChannel(Map<String, dynamic> channel) async {
    try {
      await ApiService().setChannel(channel[DatabaseHelper.columnLink]);
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => DriveScreen(channelName: channel[DatabaseHelper.columnName])));
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: const Color(0xFFEE8F8F)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            children: [
              Container(
                constraints: const BoxConstraints(maxWidth: 600),
                padding: const EdgeInsets.all(32),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [Color(0xFF1D2340), Color(0xFF171C30)], begin: Alignment.topCenter, end: Alignment.bottomCenter),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: const Color(0xFF262D4A)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Link storage', style: theme.textTheme.headlineMedium),
                        IconButton(
                          icon: const Icon(Icons.logout, color: Color(0xFF9099BE)),
                          onPressed: () async {
                            await ApiService().clearToken();
                            Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const AuthScreen()));
                          },
                        )
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text('Paste a channel ID or link below to sync to Telegram.', style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF9099BE))),
                    const SizedBox(height: 24),
                    TextField(
                      controller: _nameController,
                      decoration: const InputDecoration(hintText: 'Channel Name (Local)'),
                      style: GoogleFonts.jetbrainsMono(fontSize: 14),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _linkController,
                      decoration: const InputDecoration(hintText: '-100... or @name', prefixIcon: Icon(Icons.link, color: Color(0xFF9099BE))),
                      style: GoogleFonts.jetbrainsMono(fontSize: 14),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: Color(0xFFEE8F8F), fontSize: 13), textAlign: TextAlign.center),
                    ],
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: _loading ? null : _connect,
                      child: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF241D0E))) : const Text('Connect'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              if (_channels.isEmpty)
                Container(
                  constraints: const BoxConstraints(maxWidth: 600),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: const Color(0xFF121730), borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFF262D4A))),
                  child: Text('Connected channels and groups will appear here.', style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF9099BE)), textAlign: TextAlign.center),
                )
              else
                Container(
                  constraints: const BoxConstraints(maxWidth: 600),
                  child: Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: _channels.map((c) => _buildChannelBox(c, context)).toList(),
                  ),
                )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildChannelBox(Map<String, dynamic> channel, BuildContext context) {
    return InkWell(
      onTap: () => _selectChannel(channel),
      child: Container(
        width: 200,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: const Color(0xFF171C30), border: Border.all(color: const Color(0xFF39426E)), borderRadius: BorderRadius.circular(14)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(channel[DatabaseHelper.columnName], style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 16), maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 4),
            Text(channel[DatabaseHelper.columnLink], style: GoogleFonts.jetbrainsMono(fontSize: 12, color: const Color(0xFF9099BE)), maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------
// DRIVE SCREEN
// ---------------------------------------------------------
class DriveScreen extends StatefulWidget {
  final String channelName;
  const DriveScreen({super.key, required this.channelName});

  @override
  State<DriveScreen> createState() => _DriveScreenState();
}

class _DriveScreenState extends State<DriveScreen> {
  List<dynamic> _children = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchDrive();
  }

  Future<void> _fetchDrive() async {
    try {
      final res = await ApiService().getChildren('root');
      if (mounted) {
        setState(() {
          _children = res['children'] ?? [];
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _loading = false;
        });
      }
    }
  }

  void _goBackToLink() {
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LinkStorageScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF0E1220).withOpacity(0.85),
        elevation: 0,
        leading: IconButton(icon: const Icon(Icons.arrow_back, color: Color(0xFF9099BE)), onPressed: _goBackToLink),
        title: Row(
          children: [
            const Icon(Icons.nightlight_round, color: Color(0xFFF0D9A8), size: 24),
            const SizedBox(width: 8),
            Text('TeleMoon', style: theme.textTheme.titleLarge),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(color: const Color(0xFF262D4A), height: 1.0),
        ),
        actions: [
          IconButton(icon: const Icon(Icons.search, color: Color(0xFF9099BE)), onPressed: () {}),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: ElevatedButton(onPressed: () {}, child: const Text('Upload')),
          ),
          const Padding(
            padding: EdgeInsets.only(right: 22),
            child: CircleAvatar(backgroundColor: Color(0xFF1D2340), child: Text('U', style: TextStyle(color: Color(0xFFF0D9A8)))),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(22.0),
            child: Row(
              children: [
                Text('Drive', style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF9099BE))),
                const SizedBox(width: 8),
                const Text('/', style: TextStyle(color: Color(0xFF39426E))),
                const SizedBox(width: 8),
                Text(widget.channelName, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator(color: Color(0xFFF0D9A8))))
          else if (_error != null)
            Expanded(child: Center(child: Text(_error!, style: const TextStyle(color: Color(0xFFEE8F8F)))))
          else if (_children.isEmpty)
            Expanded(child: Center(child: Text('This folder is empty...', style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF9099BE)))))
          else
            Expanded(
              child: GridView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 22),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 200, crossAxisSpacing: 12, mainAxisSpacing: 12, childAspectRatio: 1.2),
                itemCount: _children.length,
                itemBuilder: (context, index) {
                  final node = _children[index];
                  final isFolder = node['type'] == 'folder';
                  final sizeMB = node['size'] != null ? (node['size'] / (1024 * 1024)).toStringAsFixed(1) + ' MB' : '';
                  return _buildFileBox(node['name'] ?? 'Unknown', isFolder ? 'Folder' : sizeMB, isFolder);
                },
              ),
            ),
        ],
      ),
      bottomNavigationBar: Container(
        height: 32,
        padding: const EdgeInsets.symmetric(horizontal: 22),
        decoration: const BoxDecoration(
          color: Color(0xFF0E1220),
          border: Border(top: BorderSide(color: Color(0xFF262D4A))),
        ),
        child: Row(
          children: [
            Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFF7FD6A4), shape: BoxShape.circle, boxShadow: [BoxShadow(color: Color(0x887FD6A4), blurRadius: 8)])),
            const SizedBox(width: 8),
            Text('Connected to ${widget.channelName}', style: GoogleFonts.jetbrainsMono(fontSize: 12, color: const Color(0xFF9099BE))),
          ],
        ),
      ),
    );
  }

  Widget _buildFileBox(String name, String meta, bool isFolder) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF171C30),
        border: Border.all(color: const Color(0xFF262D4A)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(isFolder ? Icons.folder : Icons.insert_drive_file, color: isFolder ? const Color(0xFFF0D9A8) : const Color(0xFF9099BE), size: 30),
          const SizedBox(height: 8),
          Text(name, style: const TextStyle(color: Color(0xFFE9ECFA), fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 4),
          Text(meta, style: GoogleFonts.jetbrainsMono(fontSize: 11, color: const Color(0xFF9099BE))),
        ],
      ),
    );
  }
}

