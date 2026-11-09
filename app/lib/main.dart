import 'dart:io';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'database_helper.dart';
import 'api_service.dart';
import 'sync/sync_engine.dart';
import 'widgets/sync_dialog.dart';
import 'widgets/error_banner.dart';
import 'widgets/server_config_dialog.dart';

class ThemeController extends ChangeNotifier {
  static final ThemeController instance = ThemeController._internal();
  ThemeController._internal();

  ThemeMode _mode = ThemeMode.dark;
  ThemeMode get mode => _mode;
  bool get isDark => _mode == ThemeMode.dark;

  Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString('telemoon_theme_mode');
      if (saved == 'light') {
        _mode = ThemeMode.light;
      } else {
        _mode = ThemeMode.dark;
      }
      notifyListeners();
    } catch (_) {}
  }

  Future<void> toggle() async {
    _mode = (_mode == ThemeMode.light) ? ThemeMode.dark : ThemeMode.light;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('telemoon_theme_mode', _mode == ThemeMode.light ? 'light' : 'dark');
    } catch (_) {}
    notifyListeners();
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  }
  await ApiService().init();
  await ThemeController.instance.init();
  runApp(const TeleMoonApp());
}

class TeleMoonApp extends StatelessWidget {
  const TeleMoonApp({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: ThemeController.instance,
      builder: (context, _) {
        Widget initialScreen;
        if (!ApiService().isAuthenticated) {
          initialScreen = const AuthScreen();
        } else if (ApiService().hasChannel) {
          initialScreen = DriveScreen(
            channelName: ApiService().channelId ?? (ApiService().handle != null ? '@${ApiService().handle}' : 'Telegram Drive'),
          );
        } else {
          initialScreen = const LinkStorageScreen();
        }

        return MaterialApp(
          title: 'TeleMoon',
          debugShowCheckedModeBanner: false,
          themeMode: ThemeController.instance.mode,
          theme: _buildTeleMoonLightTheme(),
          darkTheme: _buildTeleMoonDarkTheme(),
          home: initialScreen,
        );
      },
    );
  }

  // Authentic Blue-Black Night Theme (Original TeleMoon)
  ThemeData _buildTeleMoonDarkTheme() {
    const Color ink = Color(0xFF0E1220);
    const Color ink2 = Color(0xFF121730);
    const Color panel = Color(0xFF171C30);
    const Color line = Color(0xFF262D4A);
    const Color moon = Color(0xFFF0D9A8);
    const Color moonDeep = Color(0xFFC9A96A);
    const Color text = Color(0xFFE9ECFA);
    const Color muted = Color(0xFF9099BE);
    const Color danger = Color(0xFFEE8F8F);

    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: ink,
      colorScheme: const ColorScheme.dark(
        primary: moon,
        secondary: moonDeep,
        surface: panel,
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

  // Simple Creamy Light Theme
  ThemeData _buildTeleMoonLightTheme() {
    const Color creamBg = Color(0xFFFAF7F2);
    const Color creamInput = Color(0xFFF0EAE1);
    const Color whitePanel = Color(0xFFFFFFFF);
    const Color creamLine = Color(0xFFE5DFD3);
    const Color moonAmber = Color(0xFFC48722);
    const Color moonDeep = Color(0xFF966310);
    const Color darkText = Color(0xFF1C1917);
    const Color mutedText = Color(0xFF736B5E);
    const Color danger = Color(0xFFDC2626);

    return ThemeData(
      brightness: Brightness.light,
      scaffoldBackgroundColor: creamBg,
      colorScheme: const ColorScheme.light(
        primary: moonAmber,
        secondary: moonDeep,
        surface: whitePanel,
        error: danger,
        onPrimary: Colors.white,
        onSurface: darkText,
      ),
      textTheme: TextTheme(
        headlineLarge: GoogleFonts.spaceGrotesk(color: darkText, fontWeight: FontWeight.w700, letterSpacing: -0.5),
        headlineMedium: GoogleFonts.spaceGrotesk(color: darkText, fontWeight: FontWeight.w700),
        titleLarge: GoogleFonts.spaceGrotesk(color: darkText, fontWeight: FontWeight.w700),
        bodyLarge: GoogleFonts.spaceGrotesk(color: darkText),
        bodyMedium: GoogleFonts.spaceGrotesk(color: darkText),
        labelLarge: GoogleFonts.spaceGrotesk(color: Colors.white, fontWeight: FontWeight.w600),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: creamInput,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: creamLine)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: creamLine)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: moonDeep, width: 2)),
        hintStyle: GoogleFonts.spaceGrotesk(color: mutedText),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: moonAmber,
          foregroundColor: Colors.white,
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
    if (_handleController.text.trim().isEmpty || _passController.text.isEmpty) {
      setState(() => _error = 'Please enter both handle and password.');
      return;
    }

    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiService().login(_handleController.text, _passController.text);
      if (!mounted) return;

      final user = res['user'];
      final channelId = user != null ? user['channel_id']?.toString() : null;
      if (channelId != null && channelId.trim().isNotEmpty) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => DriveScreen(channelName: channelId),
          ),
        );
      } else {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => const LinkStorageScreen()),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final moonColor = isDark ? const Color(0xFFF0D9A8) : const Color(0xFFC48722);
    final mutedColor = isDark ? const Color(0xFF9099BE) : const Color(0xFF736B5E);

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 420),
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 34),
            decoration: BoxDecoration(
              gradient: isDark
                  ? const LinearGradient(
                      colors: [Color(0xFF1D2340), Color(0xFF171C30)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    )
                  : const LinearGradient(
                      colors: [Color(0xFFFFFFFF), Color(0xFFFBF8F3)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3)),
              boxShadow: [
                BoxShadow(
                  color: isDark ? Colors.black.withValues(alpha: 0.3) : const Color(0x14201810),
                  blurRadius: 20,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Align(
                  alignment: Alignment.topRight,
                  child: IconButton(
                    tooltip: isDark ? 'Switch to Creamy Light Mode' : 'Switch to Blue-Black Dark Mode',
                    icon: Icon(
                      isDark ? Icons.light_mode : Icons.dark_mode,
                      color: moonColor,
                      size: 20,
                    ),
                    onPressed: () => ThemeController.instance.toggle(),
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.nightlight_round, color: moonColor, size: 30),
                    const SizedBox(width: 10),
                    Text('TeleMoon', style: theme.textTheme.headlineMedium),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Your Telegram storage, as a drive.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(color: mutedColor),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _handleController,
                  decoration: InputDecoration(
                    hintText: 'moonfriend',
                    prefixText: '@ ',
                    prefixStyle: TextStyle(color: moonColor, fontWeight: FontWeight.bold),
                  ),
                  style: GoogleFonts.jetBrainsMono(fontSize: 14),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _passController,
                  obscureText: true,
                  decoration: const InputDecoration(hintText: 'Password'),
                  style: GoogleFonts.jetBrainsMono(fontSize: 14),
                  onSubmitted: (_) => _login(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 14),
                  ErrorBanner(error: _error!, onDismiss: () => setState(() => _error = null)),
                ],
                const SizedBox(height: 18),
                ElevatedButton(
                  onPressed: _loading ? null : _login,
                  child: _loading
                      ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: isDark ? const Color(0xFF241D0E) : Colors.white))
                      : const Text('Enter'),
                ),
                const SizedBox(height: 18),
                InkWell(
                  onTap: () async {
                    final changed = await showDialog<bool>(context: context, builder: (_) => const ServerConfigDialog());
                    if (changed == true && mounted) setState(() {});
                  },
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.settings, size: 13, color: mutedColor),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          'Server: ${ApiService().baseUrl}',
                          style: GoogleFonts.jetBrainsMono(fontSize: 11, color: mutedColor),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
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
  final bool canGoBack;
  const LinkStorageScreen({super.key, this.canGoBack = false});

  @override
  State<LinkStorageScreen> createState() => _LinkStorageScreenState();
}

class _LinkStorageScreenState extends State<LinkStorageScreen> {
  final _linkController = TextEditingController();
  final _nameController = TextEditingController();

  List<Map<String, dynamic>> _dialogs = [];
  List<Map<String, dynamic>> _savedChannels = [];
  bool _loadingDialogs = false;
  bool _connecting = false;
  String? _error;
  String? _dialogsError;
  String? _serverMode;
  bool _serverOffline = false;
  String? _serverOfflineMsg;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  Future<void> _loadAll() async {
    await Future.wait([
      _loadSavedChannels(),
      _loadServerStatusAndDialogs(),
    ]);
  }

  Future<void> _loadSavedChannels() async {
    try {
      final data = await DatabaseHelper.instance.queryAllChannels();
      if (mounted) setState(() => _savedChannels = data);
    } catch (_) {}
  }

  Future<void> _loadServerStatusAndDialogs() async {
    if (!mounted) return;
    setState(() {
      _loadingDialogs = true;
      _dialogsError = null;
    });

    try {
      final status = await ApiService().getStatus().catchError((_) => <String, dynamic>{});
      if (status.isNotEmpty) {
        if (status['telegram'] == 'offline') {
          if (mounted) {
            setState(() {
              _serverOffline = true;
              _serverOfflineMsg = status['error']?.toString();
              _loadingDialogs = false;
            });
          }
          return;
        }

        final mode = status['mode']?.toString();
        _serverMode = mode;
        if (mode == 'bot') {
          if (mounted) {
            setState(() {
              _loadingDialogs = false;
            });
          }
          return;
        }
      }

      final list = await ApiService().getDialogs();
      if (mounted) {
        setState(() {
          _dialogs = list;
          _loadingDialogs = false;
        });
      }
    } catch (e) {
      if (mounted) {
        final errText = e.toString().replaceFirst('Exception: ', '');
        if (errText.contains("bots can't list dialogs") || errText.contains("user session")) {
          setState(() {
            _serverMode = 'bot';
            _dialogsError = null;
            _loadingDialogs = false;
          });
        } else {
          setState(() {
            _dialogsError = errText;
            _loadingDialogs = false;
          });
        }
      }
    }
  }

  Future<void> _connectCustom() async {
    final input = _linkController.text.trim();
    if (input.isEmpty) return;

    setState(() {
      _connecting = true;
      _error = null;
    });

    try {
      final res = await ApiService().connectOrSetChannel(input);
      final assignedId = res['id']?.toString() ?? input;
      final assignedTitle = _nameController.text.trim().isNotEmpty
          ? _nameController.text.trim()
          : (res['title']?.toString() ?? input);

      // Save locally in SQLite for history
      await DatabaseHelper.instance.insertChannel({
        DatabaseHelper.columnName: assignedTitle,
        DatabaseHelper.columnLink: assignedId,
      });

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => DriveScreen(channelName: assignedTitle)),
      );
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  Future<void> _selectDialog(Map<String, dynamic> dialog) async {
    setState(() {
      _connecting = true;
      _error = null;
    });

    final channelId = dialog['id']?.toString() ?? '';
    final channelTitle = dialog['title']?.toString() ?? channelId;

    try {
      await ApiService().setChannel(channelId);

      // Save locally
      await DatabaseHelper.instance.insertChannel({
        DatabaseHelper.columnName: channelTitle,
        DatabaseHelper.columnLink: channelId,
      });

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => DriveScreen(channelName: channelTitle)),
      );
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  Future<void> _selectSaved(Map<String, dynamic> item) async {
    final link = item[DatabaseHelper.columnLink]?.toString() ?? '';
    final name = item[DatabaseHelper.columnName]?.toString() ?? link;

    setState(() {
      _connecting = true;
      _error = null;
    });

    try {
      await ApiService().setChannel(link);
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => DriveScreen(channelName: name)),
      );
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final activeChannel = ApiService().channelId;
    final hasActiveChannel = ApiService().hasChannel;
    final moonColor = isDark ? const Color(0xFFF0D9A8) : const Color(0xFFC48722);
    final moonDeepColor = isDark ? const Color(0xFFC9A96A) : const Color(0xFF966310);
    final mutedColor = isDark ? const Color(0xFF9099BE) : const Color(0xFF736B5E);

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
          child: Column(
            children: [
              // Current connection banner (if account already has one from web)
              if (hasActiveChannel) ...[
                Container(
                  constraints: const BoxConstraints(maxWidth: 680),
                  margin: const EdgeInsets.only(bottom: 20),
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1D2340) : const Color(0xFFF5EFE6),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: moonDeepColor),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle_outline, color: moonColor, size: 28),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Account Storage Active',
                              style: theme.textTheme.titleMedium?.copyWith(
                                color: isDark ? moonColor : moonDeepColor,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              'Linked channel: $activeChannel',
                              style: GoogleFonts.jetBrainsMono(
                                fontSize: 12,
                                color: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917),
                              ),
                            ),
                          ],
                        ),
                      ),
                      ElevatedButton(
                        onPressed: () {
                          Navigator.pushReplacement(
                            context,
                            MaterialPageRoute(builder: (_) => DriveScreen(channelName: activeChannel!)),
                          );
                        },
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                          backgroundColor: moonColor,
                          foregroundColor: isDark ? const Color(0xFF241D0E) : Colors.white,
                        ),
                        child: const Text('Open Drive'),
                      ),
                    ],
                  ),
                ),
              ],

              // Main container
              Container(
                constraints: const BoxConstraints(maxWidth: 680),
                padding: const EdgeInsets.all(28),
                decoration: BoxDecoration(
                  gradient: isDark
                      ? const LinearGradient(
                          colors: [Color(0xFF1D2340), Color(0xFF171C30)],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        )
                      : const LinearGradient(
                          colors: [Color(0xFFFFFFFF), Color(0xFFFBF8F3)],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        ),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3)),
                  boxShadow: [
                    BoxShadow(
                      color: isDark ? Colors.black.withValues(alpha: 0.3) : const Color(0x14201810),
                      blurRadius: 20,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.nightlight_round, color: moonColor, size: 24),
                            const SizedBox(width: 10),
                            Text('Link Storage', style: theme.textTheme.headlineMedium),
                          ],
                        ),
                        Row(
                          children: [
                            IconButton(
                              tooltip: isDark ? 'Switch to Creamy Light Mode' : 'Switch to Blue-Black Dark Mode',
                              icon: Icon(
                                isDark ? Icons.light_mode : Icons.dark_mode,
                                color: moonColor,
                                size: 20,
                              ),
                              onPressed: () => ThemeController.instance.toggle(),
                            ),
                            if (widget.canGoBack || hasActiveChannel)
                              TextButton.icon(
                                onPressed: () {
                                  Navigator.pushReplacement(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => DriveScreen(channelName: activeChannel ?? 'Drive'),
                                    ),
                                  );
                                },
                                icon: Icon(Icons.arrow_back, size: 16, color: moonColor),
                                label: Text('To Drive', style: TextStyle(color: moonColor)),
                              ),
                            IconButton(
                              tooltip: 'Sign Out',
                              icon: Icon(Icons.logout, color: mutedColor),
                              onPressed: () async {
                                final nav = Navigator.of(context);
                                await ApiService().clearToken();
                                if (!mounted) return;
                                nav.pushReplacement(
                                  MaterialPageRoute(builder: (_) => const AuthScreen()),
                                );
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Connect a private Telegram channel or group to store your synced files.',
                      style: theme.textTheme.bodyMedium?.copyWith(color: mutedColor),
                    ),
                    const SizedBox(height: 22),

                    // Manual connect fields
                    TextField(
                      controller: _linkController,
                      decoration: InputDecoration(
                        hintText: _serverMode == 'bot'
                            ? '@channel  ·  -100...  ·  t.me/channel'
                            : 'https://t.me/+...  ·  @channel  ·  -100...',
                        prefixIcon: Icon(Icons.link, color: mutedColor),
                      ),
                      style: GoogleFonts.jetBrainsMono(fontSize: 14),
                      onSubmitted: (_) => _connectCustom(),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _nameController,
                      decoration: InputDecoration(
                        hintText: 'Optional Label (e.g. Personal Cloud)',
                        prefixIcon: Icon(Icons.label_outline, color: mutedColor),
                      ),
                      style: GoogleFonts.jetBrainsMono(fontSize: 14),
                      onSubmitted: (_) => _connectCustom(),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      ErrorBanner(error: _error!, onDismiss: () => setState(() => _error = null)),
                    ],
                    const SizedBox(height: 18),
                    ElevatedButton(
                      onPressed: _connecting ? null : _connectCustom,
                      child: _connecting
                          ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: isDark ? const Color(0xFF241D0E) : Colors.white))
                          : const Text('Connect Channel'),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Available Telegram dialogs
              Container(
                constraints: const BoxConstraints(maxWidth: 680),
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF121730) : Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3)),
                  boxShadow: isDark
                      ? null
                      : const [
                          BoxShadow(color: Color(0x0A201810), blurRadius: 4, offset: Offset(0, 1)),
                        ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.telegram, color: Color(0xFF8FB4FF), size: 20),
                            const SizedBox(width: 8),
                            Text('Telegram Channels & Groups', style: theme.textTheme.titleMedium),
                          ],
                        ),
                        IconButton(
                          tooltip: 'Refresh Channels',
                          icon: Icon(Icons.refresh, size: 18, color: mutedColor),
                          onPressed: _loadingDialogs ? null : _loadServerStatusAndDialogs,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (_loadingDialogs)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 24.0),
                        child: Center(
                          child: CircularProgressIndicator(color: moonColor, strokeWidth: 2),
                        ),
                      )
                    else if (_serverOffline) ...[
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0xFF171C30) : const Color(0xFFF5EFE6),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Telegram is offline on the server.',
                              style: TextStyle(color: isDark ? const Color(0xFFF0D9A8) : const Color(0xFF966310), fontWeight: FontWeight.w600, fontSize: 14),
                            ),
                            if (_serverOfflineMsg != null && _serverOfflineMsg!.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              Text(
                                _serverOfflineMsg!,
                                style: GoogleFonts.jetBrainsMono(fontSize: 12, color: mutedColor),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ] else if (_serverMode == 'bot') ...[
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0xFF171C30) : const Color(0xFFF5EFE6),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(Icons.smart_toy_outlined, size: 18, color: moonColor),
                                const SizedBox(width: 8),
                                Text(
                                  'Bot Mode Active',
                                  style: GoogleFonts.spaceGrotesk(
                                    fontWeight: FontWeight.w600,
                                    fontSize: 14,
                                    color: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Telegram bots cannot automatically list your account chats. To link your channel:',
                              style: GoogleFonts.spaceGrotesk(fontSize: 13, color: mutedColor),
                            ),
                            const SizedBox(height: 10),
                            _buildBotStep('1', 'Add your TeleMoon bot as an Admin to your Telegram channel.', isDark, moonColor),
                            const SizedBox(height: 8),
                            _buildBotStep('2', 'Paste the channel @username or ID (e.g. -100...) in the input box above.', isDark, moonColor),
                            const SizedBox(height: 8),
                            _buildBotStep('3', 'Click "Connect Channel".', isDark, moonColor),
                          ],
                        ),
                      ),
                    ] else if (_dialogs.isNotEmpty) ...[
                      Text(
                        'Tap any channel to connect and open your drive:',
                        style: GoogleFonts.spaceGrotesk(fontSize: 12, color: mutedColor),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: _dialogs.map((d) {
                          final isCurrent = d['id']?.toString() == activeChannel;
                          final isGroup = d['group'] == true;
                          return InkWell(
                            onTap: _connecting ? null : () => _selectDialog(d),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              width: 200,
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: isCurrent
                                    ? (isDark ? const Color(0xFF1D2340) : const Color(0xFFF5EFE6))
                                    : (isDark ? const Color(0xFF171C30) : const Color(0xFFFBF8F3)),
                                border: Border.all(
                                  color: isCurrent ? moonDeepColor : (isDark ? const Color(0xFF39426E) : const Color(0xFFE5DFD3)),
                                  width: isCurrent ? 2 : 1,
                                ),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Icon(
                                        isGroup ? Icons.groups : Icons.campaign,
                                        size: 16,
                                        color: isCurrent ? moonColor : mutedColor,
                                      ),
                                      const Spacer(),
                                      if (isCurrent)
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: moonColor.withValues(alpha: 0.2),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: Text(
                                            'Active',
                                            style: TextStyle(fontSize: 10, color: isDark ? moonColor : moonDeepColor, fontWeight: FontWeight.bold),
                                          ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    d['title']?.toString() ?? 'Unnamed',
                                    style: theme.textTheme.titleMedium?.copyWith(
                                      fontSize: 14,
                                      color: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917),
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    d['username'] != null ? '@${d['username']}' : (d['id']?.toString() ?? ''),
                                    style: GoogleFonts.jetBrainsMono(fontSize: 11, color: mutedColor),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ] else ...[
                      if (_dialogsError != null)
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: isDark ? const Color(0xFF171C30) : const Color(0xFFFEF2F2),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFFECACA)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _dialogsError!,
                                style: GoogleFonts.spaceGrotesk(fontSize: 13, color: const Color(0xFFEE8F8F)),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'You can still paste your channel link or ID directly above.',
                                style: GoogleFonts.spaceGrotesk(fontSize: 12, color: mutedColor),
                              ),
                            ],
                          ),
                        )
                      else
                        Text(
                          'No channels listed. Paste your channel @username or ID above to link storage.',
                          style: GoogleFonts.spaceGrotesk(fontSize: 12, color: mutedColor),
                        ),
                    ],

                    // Saved local channels section
                    if (_savedChannels.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      Divider(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3)),
                      const SizedBox(height: 8),
                      Text('Previously Connected:', style: GoogleFonts.spaceGrotesk(fontSize: 12, color: mutedColor)),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: _savedChannels.map((item) {
                          return ActionChip(
                            backgroundColor: isDark ? const Color(0xFF171C30) : const Color(0xFFF5EFE6),
                            side: BorderSide(color: isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3)),
                            label: Text(
                              item[DatabaseHelper.columnName] ?? 'Channel',
                              style: TextStyle(color: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917), fontSize: 12),
                            ),
                            avatar: Icon(Icons.cloud_outlined, size: 16, color: moonColor),
                            onPressed: _connecting ? null : () => _selectSaved(item),
                          );
                        }).toList(),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBotStep(String step, String text, bool isDark, Color moonColor) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20,
          height: 20,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: moonColor.withValues(alpha: 0.15),
            shape: BoxShape.circle,
          ),
          child: Text(
            step,
            style: TextStyle(
              color: moonColor,
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: GoogleFonts.spaceGrotesk(
              fontSize: 13,
              height: 1.4,
              color: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917),
            ),
          ),
        ),
      ],
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
  // Navigation stack: each entry has 'id' and 'name'
  final List<Map<String, String>> _folderStack = [];
  List<dynamic> _children = [];
  bool _loading = true;
  String? _error;

  String get _currentFolderId => _folderStack.isEmpty ? 'root' : _folderStack.last['id']!;

  // Current relative folder path (e.g. "Documents/Invoices" or "" at root)
  String get _currentRelPath {
    if (_folderStack.length <= 1) return '';
    return _folderStack.sublist(1).map((f) => f['name']!).join('/');
  }

  @override
  void initState() {
    super.initState();
    _folderStack.add({'id': 'root', 'name': widget.channelName});
    _fetchDrive();
    _initSyncEngine();
  }

  void _initSyncEngine() {
    final engine = SyncEngine.instance;
    engine.loadTrackingRules();
    if (ApiService().isAuthenticated && ApiService().token != null) {
      final userProfile = Platform.environment['USERPROFILE'] ?? 'C:\\Users\\Public';
      final defaultRoot = Directory('$userProfile\\TeleMoon');
      engine.configure(
        baseUrl: ApiService().baseUrl,
        token: ApiService().token!,
        deviceId: 'telemoon_${Platform.operatingSystem}',
        syncRoot: defaultRoot,
      );
    }
  }

  Future<void> _fetchDrive() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final res = await ApiService().getChildren(_currentFolderId);
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

  void _openFolder(String id, String name) {
    setState(() {
      _folderStack.add({'id': id, 'name': name});
    });
    _fetchDrive();
  }

  void _navigateToStackIndex(int index) {
    if (index >= _folderStack.length - 1) return;
    setState(() {
      _folderStack.removeRange(index + 1, _folderStack.length);
    });
    _fetchDrive();
  }

  void _navigateBack() {
    if (_folderStack.length > 1) {
      setState(() {
        _folderStack.removeLast();
      });
      _fetchDrive();
    } else {
      _goToStorageSettings();
    }
  }

  void _goToStorageSettings() {
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => const LinkStorageScreen(canGoBack: true)),
    );
  }

  bool _isFolderTracked(String pathOrName) {
    return SyncEngine.instance.isTracked(pathOrName);
  }

  Future<void> _toggleFolderTracking(String pathOrName) async {
    final engine = SyncEngine.instance;
    final currentlyTracked = engine.isTracked(pathOrName);
    await engine.toggleTracking(pathOrName);
    if (!mounted) return;
    setState(() {});
    final isDark = Theme.of(context).brightness == Brightness.dark;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          currentlyTracked
              ? 'Untracked "$pathOrName" (excluded from sync)'
              : 'Now tracking "$pathOrName" for local sync',
          style: TextStyle(color: isDark ? const Color(0xFFE9ECFA) : Colors.white),
        ),
        backgroundColor: isDark ? const Color(0xFF1D2340) : const Color(0xFF1C1917),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  void _openSyncDialog() {
    showDialog(
      context: context,
      builder: (_) => const SyncDialog(),
    ).then((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final moonColor = isDark ? const Color(0xFFF0D9A8) : const Color(0xFFC48722);
    final moonDeepColor = isDark ? const Color(0xFFC9A96A) : const Color(0xFF966310);
    final mutedColor = isDark ? const Color(0xFF9099BE) : const Color(0xFF736B5E);
    final lineColor = isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3);
    final userHandle = ApiService().handle ?? 'user';
    final userAvatarChar = userHandle.isNotEmpty ? userHandle[0].toUpperCase() : 'U';

    final currentTrackingPath = _currentRelPath.isEmpty ? widget.channelName : _currentRelPath;
    final isCurrentFolderTracked = _isFolderTracked(currentTrackingPath);

    final isCompact = MediaQuery.of(context).size.width < 560;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: (isDark ? const Color(0xFF0E1220) : const Color(0xFFFAF7F2)).withValues(alpha: 0.95),
        elevation: 0,
        leading: IconButton(
          tooltip: _folderStack.length > 1 ? 'Go back up' : 'Link / Switch Storage',
          icon: Icon(
            _folderStack.length > 1 ? Icons.arrow_back : Icons.swap_horiz,
            color: mutedColor,
          ),
          onPressed: _navigateBack,
        ),
        title: Row(
          children: [
            Icon(Icons.nightlight_round, color: moonColor, size: 24),
            const SizedBox(width: 8),
            Text('TeleMoon', style: theme.textTheme.titleLarge),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(color: lineColor, height: 1.0),
        ),
        actions: [
          IconButton(
            tooltip: isDark ? 'Switch to Creamy Light Mode' : 'Switch to Blue-Black Dark Mode',
            icon: Icon(
              isDark ? Icons.light_mode : Icons.dark_mode,
              color: moonColor,
            ),
            onPressed: () => ThemeController.instance.toggle(),
          ),
          IconButton(
            tooltip: 'Refresh files',
            icon: Icon(Icons.refresh, color: mutedColor),
            onPressed: _fetchDrive,
          ),
          if (isCompact)
            IconButton(
              tooltip: 'Sync Settings',
              icon: Icon(Icons.sync, color: moonColor),
              onPressed: _openSyncDialog,
            )
          else
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
              child: ElevatedButton.icon(
                onPressed: _openSyncDialog,
                icon: const Icon(Icons.sync, size: 16),
                label: const Text('Sync Settings'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isDark ? const Color(0xFF1D2340) : const Color(0xFFF0EAE1),
                  foregroundColor: isDark ? const Color(0xFFF0D9A8) : const Color(0xFF966310),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999),
                    side: BorderSide(color: isDark ? const Color(0xFF39426E) : const Color(0xFFCEC5B4)),
                  ),
                ),
              ),
            ),
          PopupMenuButton<String>(
            tooltip: '@$userHandle account menu',
            offset: const Offset(0, 50),
            color: isDark ? const Color(0xFF171C30) : Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: lineColor),
            ),
            child: Padding(
              padding: const EdgeInsets.only(right: 18, left: 6),
              child: CircleAvatar(
                radius: 17,
                backgroundColor: isDark ? const Color(0xFF1D2340) : const Color(0xFFF0EAE1),
                child: Text(
                  userAvatarChar,
                  style: TextStyle(color: isDark ? const Color(0xFFF0D9A8) : const Color(0xFF966310), fontWeight: FontWeight.bold),
                ),
              ),
            ),
            onSelected: (value) async {
              if (value == 'storage') {
                _goToStorageSettings();
              } else if (value == 'server') {
                await showDialog(context: context, builder: (_) => const ServerConfigDialog());
                if (mounted) setState(() {});
              } else if (value == 'logout') {
                final nav = Navigator.of(context);
                await ApiService().clearToken();
                nav.pushReplacement(
                  MaterialPageRoute(builder: (_) => const AuthScreen()),
                );
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem<String>(
                enabled: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('@$userHandle', style: TextStyle(fontWeight: FontWeight.bold, color: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917))),
                    const SizedBox(height: 2),
                    Text('Storage: ${widget.channelName}', style: TextStyle(fontSize: 11, color: mutedColor)),
                  ],
                ),
              ),
              const PopupMenuDivider(height: 1),
              PopupMenuItem<String>(
                value: 'storage',
                child: Row(
                  children: [
                    Icon(Icons.swap_horiz, size: 18, color: mutedColor),
                    const SizedBox(width: 10),
                    const Text('Switch Storage Channel'),
                  ],
                ),
              ),
              PopupMenuItem<String>(
                value: 'server',
                child: Row(
                  children: [
                    Icon(Icons.settings, size: 18, color: mutedColor),
                    const SizedBox(width: 10),
                    const Text('Server Settings'),
                  ],
                ),
              ),
              PopupMenuItem<String>(
                value: 'logout',
                child: Row(
                  children: [
                    Icon(Icons.logout, size: 18, color: isDark ? const Color(0xFFEE8F8F) : const Color(0xFFDC2626)),
                    const SizedBox(width: 10),
                    Text('Sign Out', style: TextStyle(color: isDark ? const Color(0xFFEE8F8F) : const Color(0xFFDC2626))),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // BREADCRUMB BAR & "TRACK THIS FOLDER" ACTION
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF121730) : const Color(0xFFF0EAE1),
              border: Border(bottom: BorderSide(color: lineColor)),
            ),
            child: Row(
              children: [
                Icon(Icons.cloud_queue, size: 18, color: mutedColor),
                const SizedBox(width: 8),
                Text('Drive', style: theme.textTheme.bodyMedium?.copyWith(color: mutedColor)),
                const SizedBox(width: 6),
                Text('/', style: TextStyle(color: isDark ? const Color(0xFF39426E) : const Color(0xFFCEC5B4))),
                const SizedBox(width: 6),

                // Interactive Breadcrumbs
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: List.generate(_folderStack.length, (i) {
                        final isLast = i == _folderStack.length - 1;
                        final name = _folderStack[i]['name']!;

                        return Row(
                          children: [
                            InkWell(
                              onTap: isLast ? null : () => _navigateToStackIndex(i),
                              borderRadius: BorderRadius.circular(6),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                child: Text(
                                  name,
                                  style: TextStyle(
                                    color: isLast
                                        ? (isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917))
                                        : mutedColor,
                                    fontWeight: isLast ? FontWeight.w700 : FontWeight.w500,
                                    fontSize: 14,
                                    decoration: isLast ? TextDecoration.none : TextDecoration.underline,
                                    decorationColor: isDark ? const Color(0xFF39426E) : const Color(0xFFCEC5B4),
                                  ),
                                ),
                              ),
                            ),
                            if (!isLast) ...[
                              const SizedBox(width: 6),
                              Text('/', style: TextStyle(color: isDark ? const Color(0xFF39426E) : const Color(0xFFCEC5B4))),
                              const SizedBox(width: 6),
                            ],
                          ],
                        );
                      }),
                    ),
                  ),
                ),

                const SizedBox(width: 8),

                // "TRACK THIS FOLDER" BUTTON
                if (isCompact)
                  IconButton(
                    tooltip: isCurrentFolderTracked ? 'Tracked for Sync (tap to untrack)' : 'Track this folder',
                    icon: Icon(
                      isCurrentFolderTracked ? Icons.check_circle_rounded : Icons.bookmark_add_outlined,
                      size: 20,
                      color: isCurrentFolderTracked ? (isDark ? const Color(0xFFF0D9A8) : const Color(0xFF966310)) : mutedColor,
                    ),
                    onPressed: () => _toggleFolderTracking(currentTrackingPath),
                  )
                else
                  OutlinedButton.icon(
                    onPressed: () => _toggleFolderTracking(currentTrackingPath),
                    icon: Icon(
                      isCurrentFolderTracked ? Icons.check_circle_rounded : Icons.bookmark_add_outlined,
                      size: 16,
                      color: isCurrentFolderTracked ? (isDark ? const Color(0xFFF0D9A8) : const Color(0xFF966310)) : mutedColor,
                    ),
                    label: Text(
                      isCurrentFolderTracked ? 'Tracked for Sync' : 'Track this folder',
                      style: TextStyle(
                        color: isCurrentFolderTracked
                            ? (isDark ? const Color(0xFFF0D9A8) : const Color(0xFF966310))
                            : (isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917)),
                        fontSize: 12,
                        fontWeight: isCurrentFolderTracked ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: BorderSide(
                        color: isCurrentFolderTracked ? moonDeepColor : lineColor,
                        width: 1.2,
                      ),
                      backgroundColor: isCurrentFolderTracked
                          ? (isDark ? const Color(0xFF1D2340) : const Color(0xFFF5EFE6))
                          : (isDark ? const Color(0xFF171C30) : Colors.white),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    ),
                  ),
              ],
            ),
          ),

          if (_loading)
            Expanded(child: Center(child: CircularProgressIndicator(color: moonColor)))
          else if (_error != null)
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ErrorBanner(error: _error!),
                      const SizedBox(height: 14),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          ElevatedButton(
                            onPressed: _fetchDrive,
                            child: const Text('Retry'),
                          ),
                          const SizedBox(width: 12),
                          OutlinedButton(
                            onPressed: _goToStorageSettings,
                            style: OutlinedButton.styleFrom(
                              side: BorderSide(color: isDark ? const Color(0xFF39426E) : const Color(0xFFCEC5B4)),
                              foregroundColor: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917),
                            ),
                            child: const Text('Change Storage Channel'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            )
          else if (_children.isEmpty)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.cloud_queue, size: 48, color: isDark ? const Color(0xFF39426E) : const Color(0xFFCEC5B4)),
                    const SizedBox(height: 12),
                    Text(
                      'This folder is empty.',
                      style: theme.textTheme.bodyMedium?.copyWith(color: mutedColor),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Use "Sync Settings" or "Track this folder" to mirror files.',
                      style: GoogleFonts.spaceGrotesk(fontSize: 12, color: isDark ? const Color(0xFF6B749E) : const Color(0xFF9E9585)),
                    ),
                  ],
                ),
              ),
            )
          else
            Expanded(
              child: GridView.builder(
                padding: const EdgeInsets.all(22),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  maxCrossAxisExtent: 220,
                  crossAxisSpacing: 14,
                  mainAxisSpacing: 14,
                  childAspectRatio: 1.15,
                ),
                itemCount: _children.length,
                itemBuilder: (context, index) {
                  final node = _children[index] as Map<String, dynamic>;
                  final isFolder = node['type'] == 'folder';
                  final name = node['name'] as String? ?? 'Unknown';
                  final sizeBytes = node['size'] as num?;
                  final sizeStr = sizeBytes != null ? '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB' : '';

                  final itemRelPath = _currentRelPath.isEmpty ? name : '$_currentRelPath/$name';
                  final isTracked = _isFolderTracked(itemRelPath);

                  return _buildFileBox(
                    node: node,
                    name: name,
                    meta: isFolder ? 'Folder' : sizeStr,
                    isFolder: isFolder,
                    itemRelPath: itemRelPath,
                    isTracked: isTracked,
                  );
                },
              ),
            ),
        ],
      ),
      bottomNavigationBar: Container(
        height: 38,
        padding: const EdgeInsets.symmetric(horizontal: 22),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF0E1220) : const Color(0xFFFAF7F2),
          border: Border(top: BorderSide(color: lineColor)),
        ),
        child: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                color: Color(0xFF7FD6A4),
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: Color(0x887FD6A4), blurRadius: 8)],
              ),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                'Connected: ${widget.channelName} · ${_children.length} items',
                style: GoogleFonts.jetBrainsMono(fontSize: 11, color: mutedColor),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const Spacer(),
            ValueListenableBuilder<SyncEngineState>(
              valueListenable: SyncEngine.instance.state,
              builder: (context, syncState, _) {
                final isSyncing = syncState.status == SyncStatus.syncing;
                final isError = syncState.status == SyncStatus.error;
                final trackedCount = syncState.trackedPaths.length;

                return InkWell(
                  onTap: _openSyncDialog,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isSyncing
                            ? Icons.autorenew
                            : isError
                                ? Icons.error_outline
                                : Icons.nightlight_round,
                        size: 14,
                        color: isSyncing
                            ? moonColor
                            : isError
                                ? (isDark ? const Color(0xFFEE8F8F) : const Color(0xFFDC2626))
                                : moonColor,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        isSyncing
                            ? 'Syncing (${syncState.completedOps}/${syncState.totalOps})'
                            : isError
                                ? 'Sync Error'
                                : trackedCount > 0
                                    ? '$trackedCount items tracked'
                                    : 'Sync: All folders',
                        style: GoogleFonts.jetBrainsMono(
                          fontSize: 11,
                          color: mutedColor,
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFileBox({
    required Map<String, dynamic> node,
    required String name,
    required String meta,
    required bool isFolder,
    required String itemRelPath,
    required bool isTracked,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final moonColor = isDark ? const Color(0xFFF0D9A8) : const Color(0xFFC48722);
    final moonDeepColor = isDark ? const Color(0xFFC9A96A) : const Color(0xFF966310);
    final mutedColor = isDark ? const Color(0xFF9099BE) : const Color(0xFF736B5E);
    final cardBorder = isTracked
        ? (isDark ? const Color(0xFF39426E) : moonColor)
        : (isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3));

    return InkWell(
      onTap: () {
        if (isFolder) {
          _openFolder(node['id'] as String, name);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'File: $name ($meta)',
                style: TextStyle(color: isDark ? const Color(0xFFE9ECFA) : Colors.white),
              ),
              backgroundColor: isDark ? const Color(0xFF1D2340) : const Color(0xFF1C1917),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          );
        }
      },
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF171C30) : Colors.white,
          border: Border.all(
            color: cardBorder,
            width: isTracked ? 1.5 : 1.0,
          ),
          borderRadius: BorderRadius.circular(14),
          boxShadow: isDark
              ? null
              : const [
                  BoxShadow(color: Color(0x0A201810), blurRadius: 4, offset: Offset(0, 1)),
                ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Icon(
                  isFolder ? Icons.folder : Icons.insert_drive_file,
                  color: isFolder ? moonColor : mutedColor,
                  size: 28,
                ),
                // Tracking toggle icon button on card
                IconButton(
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  icon: Icon(
                    isTracked ? Icons.bookmark : Icons.bookmark_border,
                    size: 18,
                    color: isTracked ? moonColor : mutedColor,
                  ),
                  tooltip: isTracked ? 'Tracked for Sync (tap to untrack)' : 'Track for Sync',
                  onPressed: () => _toggleFolderTracking(itemRelPath),
                ),
              ],
            ),
            const Spacer(),
            Text(
              name,
              style: TextStyle(
                color: isDark ? const Color(0xFFE9ECFA) : const Color(0xFF1C1917),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(meta, style: GoogleFonts.jetBrainsMono(fontSize: 11, color: mutedColor)),
                if (isTracked)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF1D2340) : const Color(0xFFF5EFE6),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: isDark ? moonDeepColor : moonColor, width: 0.8),
                    ),
                    child: Text(
                      'TRACKED',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: isDark ? moonColor : moonDeepColor,
                        letterSpacing: 0.4,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
