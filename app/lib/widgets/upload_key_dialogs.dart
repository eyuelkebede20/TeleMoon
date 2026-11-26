import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:path_provider/path_provider.dart';

import '../api_service.dart';
import 'error_banner.dart';

/// Opens the Upload Key configurator dialog for [folderId].
Future<void> showUploadKeyConfigDialog(
  BuildContext context, {
  required String folderId,
  required String folderName,
  VoidCallback? onDriveChanged,
}) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => UploadKeyConfigDialog(
      folderId: folderId,
      folderName: folderName,
      onDriveChanged: onDriveChanged,
    ),
  );
}

/// Opens the Send-via-Upload-Key modal screen/dialog so anyone (even logged out)
/// can send files to a folder using a small key like `4829` or `#qq`.
Future<void> showDropUploadScreen(
  BuildContext context, {
  String? initialCode,
  VoidCallback? onUploaded,
}) {
  return Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) => DropUploadScreen(
        initialCode: initialCode,
        onUploaded: onUploaded,
      ),
    ),
  );
}

class UploadKeyConfigDialog extends StatefulWidget {
  final String folderId;
  final String folderName;
  final VoidCallback? onDriveChanged;

  const UploadKeyConfigDialog({
    super.key,
    required this.folderId,
    required this.folderName,
    this.onDriveChanged,
  });

  @override
  State<UploadKeyConfigDialog> createState() => _UploadKeyConfigDialogState();
}

class _UploadKeyConfigDialogState extends State<UploadKeyConfigDialog> {
  final _codeCtrl = TextEditingController();
  final _titleCtrl = TextEditingController();
  final _passCtrl = TextEditingController();

  List<Map<String, dynamic>> _folderLinks = [];
  List<Map<String, dynamic>> _allLinks = [];
  bool _loading = true;
  bool _saving = false;
  bool _creatingNew = false;
  bool _showAllKeys = false;
  bool _requirePassword = false;
  String? _editingId;
  String? _error;
  String? _toast;

  @override
  void initState() {
    super.initState();
    _loadLinks();
  }

  @override
  void dispose() {
    _codeCtrl.dispose();
    _titleCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  String _randomPin() {
    final rng = Random.secure();
    return (1000 + rng.nextInt(9000)).toString();
  }

  Future<void> _loadLinks() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiService().getDropLinks(widget.folderId),
        ApiService().getAllDropLinks().catchError((_) => <Map<String, dynamic>>[]),
      ]);
      if (!mounted) return;
      final folderLinks = results[0];
      setState(() {
        _folderLinks = folderLinks;
        _allLinks = results[1];
        _loading = false;
        if (folderLinks.isEmpty) {
          _creatingNew = true;
          _editingId = null;
          if (_codeCtrl.text.isEmpty) _codeCtrl.text = _randomPin();
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _startNewForm() {
    setState(() {
      _showAllKeys = false;
      _creatingNew = true;
      _editingId = null;
      _codeCtrl.text = _randomPin();
      _titleCtrl.clear();
      _passCtrl.clear();
      _requirePassword = false;
      _error = null;
    });
  }

  void _startEdit(Map<String, dynamic> link) {
    setState(() {
      _showAllKeys = false;
      _creatingNew = false;
      _editingId = link['id']?.toString();
      _codeCtrl.text = link['code']?.toString() ?? '';
      _titleCtrl.text = link['title']?.toString() ?? '';
      _passCtrl.clear();
      _requirePassword = link['has_password'] == true;
      _error = null;
    });
  }

  Future<void> _saveForm() async {
    final cleanedCode = ApiService.cleanDropCode(_codeCtrl.text);
    if (_requirePassword && _editingId == null && _passCtrl.text.isEmpty) {
      setState(() => _error = 'Enter a PIN or password, or disable password protection.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
      _toast = null;
    });

    try {
      if (_editingId != null) {
        final String? pwdUpdate = !_requirePassword
            ? ''
            : (_passCtrl.text.isNotEmpty ? _passCtrl.text : null);
        await ApiService().updateDropLink(
          _editingId!,
          code: cleanedCode.isNotEmpty ? cleanedCode : null,
          title: _titleCtrl.text.trim(),
          password: pwdUpdate,
        );
        _toast = 'Updated Upload Key #${cleanedCode.isEmpty ? '' : cleanedCode}';
      } else {
        final created = await ApiService().createDropLink(
          widget.folderId,
          code: cleanedCode.isNotEmpty ? cleanedCode : null,
          title: _titleCtrl.text.trim(),
          password: _requirePassword ? _passCtrl.text : null,
        );
        _toast = 'Created Upload Key #${created['code']}';
      }
      if (!mounted) return;
      _creatingNew = false;
      _editingId = null;
      _passCtrl.clear();
      await _loadLinks();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _toggleActive(Map<String, dynamic> link) async {
    setState(() => _saving = true);
    try {
      await ApiService().updateDropLink(
        link['id'].toString(),
        isActive: link['is_active'] != true,
      );
      await _loadLinks();
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _deleteLink(Map<String, dynamic> link) async {
    setState(() => _saving = true);
    try {
      await ApiService().deleteDropLink(link['id'].toString());
      if (mounted) {
        _toast = 'Deleted Upload Key #${link['code']}';
      }
      await _loadLinks();
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _copyText(String text, String label) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    setState(() => _toast = 'Copied $label');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final moonColor = isDark ? const Color(0xFFF0D9A8) : const Color(0xFFC48722);
    final mutedColor = isDark ? const Color(0xFF9099BE) : const Color(0xFF736B5E);
    final lineColor = isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3);
    final panelBg = isDark ? const Color(0xFF171C30) : const Color(0xFFF5EFE6);

    return Dialog(
      backgroundColor: isDark ? const Color(0xFF121730) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: lineColor),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520, maxHeight: 680),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 12),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: moonColor.withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.vpn_key_outlined, color: moonColor, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Upload Keys', style: theme.textTheme.titleMedium),
                        Text(
                          'Receive files into "${widget.folderName}" with a small key',
                          style: GoogleFonts.spaceGrotesk(fontSize: 12, color: mutedColor),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: Icon(Icons.close, color: mutedColor),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: lineColor),

            // Mode Tabs
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 0),
              child: Row(
                children: [
                  ChoiceChip(
                    label: Text('This Folder (${_folderLinks.length})'),
                    selected: !_showAllKeys,
                    onSelected: (_) => setState(() => _showAllKeys = false),
                  ),
                  const SizedBox(width: 8),
                  ChoiceChip(
                    label: Text('All Keys (${_allLinks.length})'),
                    selected: _showAllKeys,
                    onSelected: (_) => setState(() => _showAllKeys = true),
                  ),
                  const Spacer(),
                  if (!_showAllKeys && !_creatingNew && _editingId == null)
                    TextButton.icon(
                      onPressed: _startNewForm,
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('New Key'),
                    ),
                ],
              ),
            ),

            if (_toast != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 0),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF7FD6A4).withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF7FD6A4).withValues(alpha: 0.4)),
                  ),
                  child: Text(
                    _toast!,
                    style: TextStyle(
                      fontSize: 12,
                      color: isDark ? const Color(0xFF7FD6A4) : const Color(0xFF15803D),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),

            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 0),
                child: ErrorBanner(
                  error: _error!,
                  onDismiss: () => setState(() => _error = null),
                ),
              ),

            // Body
            Flexible(
              child: _loading
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 42),
                      child: Center(child: CircularProgressIndicator(color: moonColor, strokeWidth: 2)),
                    )
                  : SingleChildScrollView(
                      padding: const EdgeInsets.all(18),
                      child: _showAllKeys
                          ? _buildAllKeysList(panelBg, lineColor, mutedColor, moonColor, isDark)
                          : ((_creatingNew || _editingId != null)
                              ? _buildKeyForm(panelBg, lineColor, mutedColor, moonColor, isDark)
                              : _buildFolderKeysList(panelBg, lineColor, mutedColor, moonColor, isDark)),
                    ),
            ),

            Divider(height: 1, color: lineColor),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              child: Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: () {
                      Navigator.of(context).pop();
                      showDropUploadScreen(
                        context,
                        initialCode: _folderLinks.isNotEmpty
                            ? _folderLinks.first['code']?.toString()
                            : null,
                        onUploaded: widget.onDriveChanged,
                      );
                    },
                    icon: const Icon(Icons.upload_file, size: 16),
                    label: const Text('Send Files via Key'),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Done'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildKeyForm(
    Color panelBg,
    Color lineColor,
    Color mutedColor,
    Color moonColor,
    bool isDark,
  ) {
    final isEdit = _editingId != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          isEdit ? 'Edit Upload Key' : 'Create Upload Key',
          style: GoogleFonts.spaceGrotesk(fontWeight: FontWeight.w700, fontSize: 15),
        ),
        const SizedBox(height: 6),
        Text(
          'Use a 4-digit PIN (e.g. 4829) or a short word (1-32 letters/numbers) for fast uploads.',
          style: TextStyle(fontSize: 12, color: mutedColor),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _codeCtrl,
                decoration: InputDecoration(
                  labelText: 'Small Key',
                  hintText: '4829 or qq',
                  prefixText: '# ',
                  prefixStyle: TextStyle(color: moonColor, fontWeight: FontWeight.bold),
                ),
                style: GoogleFonts.jetBrainsMono(fontSize: 15, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: () => setState(() => _codeCtrl.text = _randomPin()),
              icon: const Icon(Icons.casino_outlined, size: 16),
              label: const Text('Random'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _titleCtrl,
          decoration: const InputDecoration(
            labelText: 'Optional Label',
            hintText: 'e.g. Phone Camera Roll, Client Drop',
          ),
        ),
        const SizedBox(height: 10),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          title: const Text('Require PIN / Password', style: TextStyle(fontSize: 14)),
          subtitle: Text(
            _requirePassword ? 'Senders must unlock with this secret first' : 'Anyone with the key can upload',
            style: TextStyle(fontSize: 12, color: mutedColor),
          ),
          value: _requirePassword,
          onChanged: (v) => setState(() => _requirePassword = v),
        ),
        if (_requirePassword) ...[
          const SizedBox(height: 6),
          TextField(
            controller: _passCtrl,
            obscureText: true,
            decoration: InputDecoration(
              labelText: isEdit ? 'New Password (leave blank to keep)' : 'Upload Password / PIN',
              hintText: 'Enter secret',
            ),
          ),
        ],
        const SizedBox(height: 16),
        Row(
          children: [
            if (_folderLinks.isNotEmpty)
              Expanded(
                child: OutlinedButton(
                  onPressed: _saving
                      ? null
                      : () => setState(() {
                            _creatingNew = false;
                            _editingId = null;
                          }),
                  child: const Text('Cancel'),
                ),
              ),
            if (_folderLinks.isNotEmpty) const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: ElevatedButton(
                onPressed: _saving ? null : _saveForm,
                child: _saving
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(isEdit ? 'Save Key' : 'Create Upload Key'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildFolderKeysList(
    Color panelBg,
    Color lineColor,
    Color mutedColor,
    Color moonColor,
    bool isDark,
  ) {
    if (_folderLinks.isEmpty) {
      return Center(
        child: Text('No upload keys configured for this folder yet.', style: TextStyle(color: mutedColor)),
      );
    }

    return Column(
      children: _folderLinks.map((link) {
        final code = link['code']?.toString() ?? '';
        final title = link['title']?.toString() ?? '';
        final active = link['is_active'] == true;
        final uploads = link['upload_count'] ?? 0;
        final fullUrl = '${ApiService().originUrl}/#/d/$code';

        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: panelBg,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: lineColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: moonColor.withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '#$code',
                      style: GoogleFonts.jetBrainsMono(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: moonColor,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (title.isNotEmpty)
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                        overflow: TextOverflow.ellipsis,
                      ),
                    )
                  else
                    const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: (active ? const Color(0xFF7FD6A4) : mutedColor).withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      active ? 'Active' : 'Paused',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: active ? (isDark ? const Color(0xFF7FD6A4) : const Color(0xFF15803D)) : mutedColor,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                fullUrl,
                style: GoogleFonts.jetBrainsMono(fontSize: 11, color: mutedColor),
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 6),
              Text(
                '$uploads uploads · ${link['has_password'] == true ? 'PIN protected' : 'Open with key'}',
                style: TextStyle(fontSize: 12, color: mutedColor),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _copyText(code, 'key #$code'),
                    icon: const Icon(Icons.copy, size: 14),
                    label: const Text('Copy Key'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _copyText(fullUrl, 'upload link'),
                    icon: const Icon(Icons.link, size: 14),
                    label: const Text('Copy Link'),
                  ),
                  TextButton.icon(
                    onPressed: () => _startEdit(link),
                    icon: const Icon(Icons.edit_outlined, size: 14),
                    label: const Text('Edit'),
                  ),
                  TextButton(
                    onPressed: _saving ? null : () => _toggleActive(link),
                    child: Text(active ? 'Pause' : 'Resume'),
                  ),
                  TextButton(
                    onPressed: _saving ? null : () => _deleteLink(link),
                    style: TextButton.styleFrom(
                      foregroundColor: isDark ? const Color(0xFFEE8F8F) : const Color(0xFFDC2626),
                    ),
                    child: const Text('Delete'),
                  ),
                ],
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildAllKeysList(
    Color panelBg,
    Color lineColor,
    Color mutedColor,
    Color moonColor,
    bool isDark,
  ) {
    if (_allLinks.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: Text('You have not created any upload keys yet.', style: TextStyle(color: mutedColor)),
        ),
      );
    }
    return Column(
      children: _allLinks.map((link) {
        final code = link['code']?.toString() ?? '';
        final folder = link['folder_name']?.toString() ?? link['folder_id']?.toString() ?? 'Folder';
        final active = link['is_active'] == true;
        final uploads = link['upload_count'] ?? 0;

        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: panelBg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: lineColor),
          ),
          child: Row(
            children: [
              Text(
                '#$code',
                style: GoogleFonts.jetBrainsMono(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: moonColor,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      link['title']?.toString().isNotEmpty == true ? link['title'].toString() : folder,
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      'Folder: $folder · $uploads uploads · ${active ? 'Active' : 'Paused'}',
                      style: TextStyle(fontSize: 11, color: mutedColor),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Copy Key',
                icon: Icon(Icons.copy, size: 17, color: mutedColor),
                onPressed: () => _copyText(code, 'key #$code'),
              ),
              IconButton(
                tooltip: 'Send files with #$code',
                icon: Icon(Icons.upload_file, size: 18, color: moonColor),
                onPressed: () {
                  Navigator.of(context).pop();
                  showDropUploadScreen(
                    context,
                    initialCode: code,
                    onUploaded: widget.onDriveChanged,
                  );
                },
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

/// Mobile/desktop screen to send files or text notes into any folder using its small key.
class DropUploadScreen extends StatefulWidget {
  final String? initialCode;
  final VoidCallback? onUploaded;

  const DropUploadScreen({
    super.key,
    this.initialCode,
    this.onUploaded,
  });

  @override
  State<DropUploadScreen> createState() => _DropUploadScreenState();
}

class _DropUploadScreenState extends State<DropUploadScreen> {
  final _keyCtrl = TextEditingController();
  final _pinCtrl = TextEditingController();
  final _filePathCtrl = TextEditingController();
  final _noteNameCtrl = TextEditingController(text: 'note.txt');
  final _noteBodyCtrl = TextEditingController();

  Map<String, dynamic>? _dropInfo;
  String? _ticket;
  bool _loadingKey = false;
  bool _verifying = false;
  bool _uploading = false;
  double _progress = 0;
  String? _error;
  String? _successMsg;
  List<File> _localFiles = [];

  @override
  void initState() {
    super.initState();
    _loadLocalSuggestions();
    if (widget.initialCode != null && widget.initialCode!.trim().isNotEmpty) {
      _keyCtrl.text = widget.initialCode!.trim();
      _lookupKey(widget.initialCode!.trim());
    }
  }

  @override
  void dispose() {
    _keyCtrl.dispose();
    _pinCtrl.dispose();
    _filePathCtrl.dispose();
    _noteNameCtrl.dispose();
    _noteBodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadLocalSuggestions() async {
    final candidates = <Directory>[];
    try {
      candidates.add(await getApplicationDocumentsDirectory());
    } catch (_) {}
    if (Platform.isAndroid) {
      candidates.add(Directory('/storage/emulated/0/Download'));
      candidates.add(Directory('/storage/emulated/0/Documents'));
    } else if (Platform.isWindows) {
      final home = Platform.environment['USERPROFILE'];
      if (home != null && home.isNotEmpty) {
        candidates.add(Directory('$home\\Downloads'));
        candidates.add(Directory('$home\\Desktop'));
      }
    } else {
      final home = Platform.environment['HOME'];
      if (home != null && home.isNotEmpty) {
        candidates.add(Directory('$home/Downloads'));
        candidates.add(Directory('$home/Desktop'));
      }
    }

    final found = <File>[];
    for (final dir in candidates) {
      try {
        if (await dir.exists()) {
          await for (final entity in dir.list(followLinks: false)) {
            if (entity is File) {
              found.add(entity);
              if (found.length >= 25) break;
            }
          }
        }
      } catch (_) {}
      if (found.length >= 25) break;
    }

    if (mounted) {
      setState(() => _localFiles = found);
    }
  }

  Future<void> _lookupKey([String? raw]) async {
    final clean = ApiService.cleanDropCode(raw ?? _keyCtrl.text);
    if (clean.isEmpty) {
      setState(() => _error = 'Enter a small upload key (like 4829) or link');
      return;
    }

    setState(() {
      _loadingKey = true;
      _error = null;
      _successMsg = null;
      _dropInfo = null;
      _ticket = null;
      _pinCtrl.clear();
    });

    try {
      final info = await ApiService().getDropInfo(clean);
      if (!mounted) return;
      setState(() {
        _keyCtrl.text = info['code']?.toString() ?? clean;
        _dropInfo = info;
        _ticket = info['ticket']?.toString();
        _loadingKey = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingKey = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _unlockKey() async {
    final code = _dropInfo?['code']?.toString() ?? ApiService.cleanDropCode(_keyCtrl.text);
    setState(() {
      _verifying = true;
      _error = null;
    });
    try {
      final res = await ApiService().verifyDropPassword(code, _pinCtrl.text);
      if (!mounted) return;
      setState(() {
        _ticket = res['ticket']?.toString();
        _verifying = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _uploadSelectedFile(File file) async {
    if (_dropInfo == null || _ticket == null) return;
    if (!await file.exists()) {
      setState(() => _error = 'File not found: ${file.path}');
      return;
    }
    setState(() {
      _uploading = true;
      _progress = 0;
      _error = null;
      _successMsg = null;
    });
    try {
      final node = await ApiService().uploadFileToDrop(
        code: _dropInfo!['code'].toString(),
        ticket: _ticket!,
        file: file,
        onProgress: (sent, total) {
          if (mounted && total > 0) {
            setState(() => _progress = sent / total);
          }
        },
      );
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _progress = 1;
        _successMsg = 'Uploaded "${node['name']}" into ${_dropInfo!['folderName']}';
      });
      widget.onUploaded?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _uploadNote() async {
    if (_dropInfo == null || _ticket == null) return;
    final name = _noteNameCtrl.text.trim().isEmpty ? 'note.txt' : _noteNameCtrl.text.trim();
    final content = _noteBodyCtrl.text;
    if (content.trim().isEmpty) {
      setState(() => _error = 'Write something to upload as a note, or pick a file.');
      return;
    }
    setState(() {
      _uploading = true;
      _progress = 0;
      _error = null;
      _successMsg = null;
    });
    try {
      final bytes = utf8.encode(content);
      final node = await ApiService().uploadBytesToDrop(
        code: _dropInfo!['code'].toString(),
        ticket: _ticket!,
        name: name,
        bytes: bytes,
        mime: 'text/plain',
        onProgress: (sent, total) {
          if (mounted && total > 0) {
            setState(() => _progress = sent / total);
          }
        },
      );
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _progress = 1;
        _noteBodyCtrl.clear();
        _successMsg = 'Uploaded "${node['name']}" into ${_dropInfo!['folderName']}';
      });
      widget.onUploaded?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final moonColor = isDark ? const Color(0xFFF0D9A8) : const Color(0xFFC48722);
    final mutedColor = isDark ? const Color(0xFF9099BE) : const Color(0xFF736B5E);
    final lineColor = isDark ? const Color(0xFF262D4A) : const Color(0xFFE5DFD3);
    final cardColor = isDark ? const Color(0xFF121730) : Colors.white;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Send via Upload Key'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Center(
          child: Container(
            constraints: const BoxConstraints(maxWidth: 540),
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: cardColor,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: lineColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Quick Upload with a Small Key',
                  style: theme.textTheme.titleLarge,
                ),
                const SizedBox(height: 6),
                Text(
                  'Enter any folder key (e.g. 4829, #qq) or drop URL from TeleMoon.',
                  style: TextStyle(fontSize: 13, color: mutedColor),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _keyCtrl,
                        decoration: InputDecoration(
                          labelText: 'Upload Key',
                          hintText: '4829 or #qq',
                          prefixText: '# ',
                          prefixStyle: TextStyle(color: moonColor, fontWeight: FontWeight.bold),
                        ),
                        style: GoogleFonts.jetBrainsMono(fontSize: 15, fontWeight: FontWeight.bold),
                        onSubmitted: (_) => _lookupKey(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    ElevatedButton(
                      onPressed: _loadingKey ? null : () => _lookupKey(),
                      child: _loadingKey
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Open'),
                    ),
                  ],
                ),

                if (_error != null) ...[
                  const SizedBox(height: 14),
                  ErrorBanner(error: _error!, onDismiss: () => setState(() => _error = null)),
                ],

                if (_successMsg != null) ...[
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF7FD6A4).withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFF7FD6A4).withValues(alpha: 0.45)),
                    ),
                    child: Text(
                      _successMsg!,
                      style: TextStyle(
                        color: isDark ? const Color(0xFF7FD6A4) : const Color(0xFF15803D),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],

                if (_dropInfo != null) ...[
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF171C30) : const Color(0xFFF5EFE6),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: lineColor),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'UPLOAD KEY · #${_dropInfo!['code']}',
                          style: GoogleFonts.jetBrainsMono(
                            fontSize: 12,
                            color: moonColor,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Destination: ${_dropInfo!['folderName']} (@${_dropInfo!['ownerHandle']})',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (_dropInfo!['storageReady'] == false) ...[
                          const SizedBox(height: 8),
                          const Text(
                            'Warning: Owner Telegram channel is not ready/linked on server yet.',
                            style: TextStyle(color: Colors.orangeAccent, fontSize: 12),
                          ),
                        ],
                      ],
                    ),
                  ),

                  if (_dropInfo!['hasPassword'] == true && _ticket == null) ...[
                    const SizedBox(height: 16),
                    TextField(
                      controller: _pinCtrl,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: 'Key Password / PIN',
                        hintText: 'Enter secret to unlock uploads',
                      ),
                      onSubmitted: (_) => _unlockKey(),
                    ),
                    const SizedBox(height: 10),
                    ElevatedButton(
                      onPressed: _verifying ? null : _unlockKey,
                      child: _verifying
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Unlock Upload Key'),
                    ),
                  ] else if (_ticket != null) ...[
                    if (_uploading) ...[
                      const SizedBox(height: 16),
                      LinearProgressIndicator(value: _progress > 0 ? _progress : null, color: moonColor),
                      const SizedBox(height: 6),
                      Text('Uploading...', style: TextStyle(fontSize: 12, color: mutedColor)),
                    ],
                    const SizedBox(height: 18),
                    Text('Send a File by Path', style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _filePathCtrl,
                            decoration: const InputDecoration(
                              hintText: '/path/to/file or tap a recent file below',
                            ),
                            style: GoogleFonts.jetBrainsMono(fontSize: 12),
                          ),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: _uploading
                              ? null
                              : () {
                                  final p = _filePathCtrl.text.trim();
                                  if (p.isNotEmpty) _uploadSelectedFile(File(p));
                                },
                          child: const Text('Send'),
                        ),
                      ],
                    ),

                    if (_localFiles.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        'Quick Pick (Downloads / Documents):',
                        style: TextStyle(fontSize: 12, color: mutedColor),
                      ),
                      const SizedBox(height: 6),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 160),
                        child: ListView.separated(
                          shrinkWrap: true,
                          itemCount: _localFiles.length,
                          separatorBuilder: (_, _) => Divider(height: 1, color: lineColor),
                          itemBuilder: (_, i) {
                            final f = _localFiles[i];
                            final name = f.path.split(Platform.pathSeparator).last;
                            return ListTile(
                              dense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                              leading: Icon(Icons.insert_drive_file_outlined, size: 18, color: moonColor),
                              title: Text(name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                              trailing: TextButton(
                                onPressed: _uploading ? null : () => _uploadSelectedFile(f),
                                child: const Text('Upload'),
                              ),
                            );
                          },
                        ),
                      ),
                    ],

                    const SizedBox(height: 18),
                    Divider(height: 1, color: lineColor),
                    const SizedBox(height: 14),
                    Text('Or Send a Quick Note', style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _noteNameCtrl,
                      decoration: const InputDecoration(labelText: 'Filename'),
                      style: GoogleFonts.jetBrainsMono(fontSize: 13),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _noteBodyCtrl,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Text content',
                        hintText: 'Paste text, links, or notes to save straight to this folder...',
                      ),
                    ),
                    const SizedBox(height: 10),
                    ElevatedButton.icon(
                      onPressed: _uploading ? null : _uploadNote,
                      icon: const Icon(Icons.send, size: 16),
                      label: const Text('Upload Note'),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
