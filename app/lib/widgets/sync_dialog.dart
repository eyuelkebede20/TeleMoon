import 'dart:io';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import '../api_service.dart';
import '../sync/sync_engine.dart';

class SyncDialog extends StatefulWidget {
  const SyncDialog({super.key});

  @override
  State<SyncDialog> createState() => _SyncDialogState();
}

class _SyncDialogState extends State<SyncDialog> {
  final _pathController = TextEditingController();
  final _customPathController = TextEditingController();

  List<Map<String, dynamic>> _availableFolders = [];
  bool _loadingFolders = false;

  @override
  void initState() {
    super.initState();
    _loadSyncPath();
    _loadAvailableFolders();
  }

  Future<void> _loadSyncPath() async {
    final engine = SyncEngine.instance;
    String currentPath = engine.state.value.syncRoot ?? '';

    if (currentPath.isEmpty) {
      try {
        if (Platform.isWindows) {
          final userProfile = Platform.environment['USERPROFILE'] ?? 'C:\\Users\\Public';
          currentPath = p.join(userProfile, 'TeleMoon');
        } else {
          final docDir = await getApplicationDocumentsDirectory();
          currentPath = p.join(docDir.path, 'TeleMoon');
        }
      } catch (_) {
        currentPath = p.join(Directory.current.path, 'TeleMoon');
      }
    }

    _pathController.text = currentPath;

    // Configure engine if not yet configured
    if (ApiService().isAuthenticated && ApiService().token != null) {
      engine.configure(
        baseUrl: ApiService().baseUrl,
        token: ApiService().token!,
        deviceId: 'telemoon_${Platform.operatingSystem}',
        syncRoot: Directory(currentPath),
      );
    }

    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _loadAvailableFolders() async {
    setState(() => _loadingFolders = true);
    final items = <Map<String, dynamic>>[];

    try {
      if (ApiService().isAuthenticated) {
        final res = await ApiService().getChildren('root');
        final children = res['children'] as List<dynamic>? ?? [];
        for (final c in children) {
          final name = c['name']?.toString() ?? 'Item';
          items.add({
            'name': name,
            'relPath': name,
            'isFolder': c['type'] == 'folder',
            'nodeId': c['id']?.toString(),
          });
        }
      }
    } catch (_) {}

    // Check local root folder if configured
    final path = _pathController.text.trim();
    if (path.isNotEmpty) {
      try {
        final dir = Directory(path);
        if (await dir.exists()) {
          await for (final entity in dir.list(followLinks: false)) {
            final rel = p.basename(entity.path);
            if (!items.any((i) => (i['relPath'] as String).toLowerCase() == rel.toLowerCase())) {
              items.add({
                'name': rel,
                'relPath': rel,
                'isFolder': entity is Directory,
                'nodeId': null,
              });
            }
          }
        }
      } catch (_) {}
    }

    // Also include tracked and excluded paths
    for (final tr in SyncEngine.instance.trackedPaths) {
      if (!items.any((i) => (i['relPath'] as String).toLowerCase() == tr.toLowerCase())) {
        items.add({
          'name': tr,
          'relPath': tr,
          'isFolder': true,
          'nodeId': null,
        });
      }
    }
    for (final ex in SyncEngine.instance.excludedPaths) {
      if (!items.any((i) => (i['relPath'] as String).toLowerCase() == ex.toLowerCase())) {
        items.add({
          'name': ex,
          'relPath': ex,
          'isFolder': true,
          'nodeId': null,
        });
      }
    }

    if (mounted) {
      setState(() {
        _availableFolders = items;
        _loadingFolders = false;
      });
    }
  }

  Future<void> _applyFolder() async {
    final path = _pathController.text.trim();
    if (path.isEmpty) return;

    final dir = Directory(path);
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }

    if (ApiService().isAuthenticated && ApiService().token != null) {
      SyncEngine.instance.configure(
        baseUrl: ApiService().baseUrl,
        token: ApiService().token!,
        deviceId: 'telemoon_${Platform.operatingSystem}',
        syncRoot: dir,
      );
      await SyncEngine.instance.sync();
    }

    _loadAvailableFolders();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Sync folder updated: $path'),
          backgroundColor: const Color(0xFF1D2340),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  Future<void> _addCustomTrackedPath() async {
    final path = _customPathController.text.trim();
    if (path.isEmpty) return;
    _customPathController.clear();
    await SyncEngine.instance.trackPath(path);
    await _loadAvailableFolders();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Now tracking: $path'),
          backgroundColor: const Color(0xFF1D2340),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Dialog(
      backgroundColor: const Color(0xFF171C30),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFF262D4A)),
      ),
      child: Container(
        width: 580,
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.88),
        padding: const EdgeInsets.all(24),
        child: SingleChildScrollView(
          child: ValueListenableBuilder<SyncEngineState>(
            valueListenable: SyncEngine.instance.state,
            builder: (context, state, _) {
              final isSyncing = state.status == SyncStatus.syncing;
              final isError = state.status == SyncStatus.error;

              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        isSyncing ? Icons.sync : Icons.nightlight_round,
                        color: isError ? const Color(0xFFEE8F8F) : const Color(0xFFF0D9A8),
                        size: 26,
                      ),
                      const SizedBox(width: 12),
                      Text('Drive Sync & Tracking', style: theme.textTheme.titleLarge?.copyWith(fontSize: 18)),
                      const Spacer(),
                      IconButton(
                        icon: const Icon(Icons.close, color: Color(0xFF9099BE)),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Mirror cloud files to a local folder and selectively track specific folders and files.',
                    style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF9099BE), fontSize: 13),
                  ),

                  const SizedBox(height: 18),
                  Text('Local Sync Folder', style: GoogleFonts.spaceGrotesk(fontSize: 13, fontWeight: FontWeight.w600, color: const Color(0xFFE9ECFA))),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _pathController,
                          style: GoogleFonts.jetBrainsMono(fontSize: 13),
                          decoration: const InputDecoration(
                            hintText: 'C:\\Users\\...\\TeleMoon',
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      ElevatedButton(
                        onPressed: isSyncing ? null : _applyFolder,
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                        ),
                        child: const Text('Set Path', style: TextStyle(fontSize: 13)),
                      ),
                    ],
                  ),

                  // TRACKED FOLDERS & SELECTIVE SYNC SECTION
                  const SizedBox(height: 22),
                  Row(
                    children: [
                      const Icon(Icons.folder_special, size: 16, color: Color(0xFFF0D9A8)),
                      const SizedBox(width: 8),
                      Text(
                        'Tracked Folders & Files',
                        style: GoogleFonts.spaceGrotesk(fontSize: 13, fontWeight: FontWeight.w600, color: const Color(0xFFE9ECFA)),
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: () async {
                          for (final item in _availableFolders) {
                            final p = item['relPath'] as String;
                            await SyncEngine.instance.trackPath(p);
                          }
                          setState(() {});
                        },
                        child: const Text('Track All', style: TextStyle(fontSize: 11, color: Color(0xFFF0D9A8))),
                      ),
                      TextButton(
                        onPressed: () async {
                          for (final item in _availableFolders) {
                            final p = item['relPath'] as String;
                            await SyncEngine.instance.untrackPath(p);
                          }
                          setState(() {});
                        },
                        child: const Text('Untrack All', style: TextStyle(fontSize: 11, color: Color(0xFF9099BE))),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Toggle which folders and files are actively tracked and mirrored locally.',
                    style: GoogleFonts.spaceGrotesk(fontSize: 11, color: const Color(0xFF9099BE)),
                  ),
                  const SizedBox(height: 10),

                  // Folders List Box
                  Container(
                    constraints: const BoxConstraints(maxHeight: 180),
                    decoration: BoxDecoration(
                      color: const Color(0xFF121730),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFF262D4A)),
                    ),
                    child: _loadingFolders
                        ? const Center(
                            child: Padding(
                              padding: EdgeInsets.all(20.0),
                              child: CircularProgressIndicator(color: Color(0xFFF0D9A8), strokeWidth: 2),
                            ),
                          )
                        : _availableFolders.isEmpty
                            ? Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(20.0),
                                  child: Text(
                                    'No folders found yet. Link storage and upload files to start tracking.',
                                    style: GoogleFonts.spaceGrotesk(fontSize: 12, color: const Color(0xFF9099BE)),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                              )
                            : ListView.separated(
                                shrinkWrap: true,
                                itemCount: _availableFolders.length,
                                separatorBuilder: (context, idx) => const Divider(height: 1, color: Color(0xFF1D2340)),
                                itemBuilder: (context, index) {
                                  final item = _availableFolders[index];
                                  final relPath = item['relPath'] as String;
                                  final name = item['name'] as String;
                                  final isFolder = item['isFolder'] == true;
                                  final isTracked = SyncEngine.instance.isTracked(relPath);

                                  return Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                    child: Row(
                                      children: [
                                        Icon(
                                          isFolder ? Icons.folder : Icons.insert_drive_file,
                                          color: isFolder ? const Color(0xFFF0D9A8) : const Color(0xFF9099BE),
                                          size: 18,
                                        ),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                name,
                                                style: const TextStyle(fontSize: 13, color: Color(0xFFE9ECFA)),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                              Text(
                                                relPath,
                                                style: GoogleFonts.jetBrainsMono(fontSize: 10, color: const Color(0xFF9099BE)),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ],
                                          ),
                                        ),
                                        InkWell(
                                          onTap: () async {
                                            await SyncEngine.instance.toggleTracking(relPath);
                                            setState(() {});
                                          },
                                          borderRadius: BorderRadius.circular(999),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: isTracked ? const Color(0xFFF0D9A8).withValues(alpha: 0.15) : const Color(0xFF1D2340),
                                              borderRadius: BorderRadius.circular(999),
                                              border: Border.all(
                                                color: isTracked ? const Color(0xFFC9A96A) : const Color(0xFF39426E),
                                              ),
                                            ),
                                            child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(
                                                  isTracked ? Icons.check_circle : Icons.remove_circle_outline,
                                                  size: 13,
                                                  color: isTracked ? const Color(0xFFF0D9A8) : const Color(0xFF9099BE),
                                                ),
                                                const SizedBox(width: 5),
                                                Text(
                                                  isTracked ? 'Tracked' : 'Excluded',
                                                  style: TextStyle(
                                                    fontSize: 11,
                                                    fontWeight: FontWeight.w600,
                                                    color: isTracked ? const Color(0xFFF0D9A8) : const Color(0xFF9099BE),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  );
                                },
                              ),
                  ),

                  // Add Custom Tracked Path Row
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _customPathController,
                          style: GoogleFonts.jetBrainsMono(fontSize: 12),
                          decoration: InputDecoration(
                            hintText: 'Track custom folder path (e.g. Work/Projects)',
                            isDense: true,
                            hintStyle: GoogleFonts.spaceGrotesk(fontSize: 11, color: const Color(0xFF6B749E)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          ),
                          onSubmitted: (_) => _addCustomTrackedPath(),
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        onPressed: _addCustomTrackedPath,
                        icon: const Icon(Icons.add, size: 14),
                        label: const Text('Track', style: TextStyle(fontSize: 12)),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Color(0xFF39426E)),
                          foregroundColor: const Color(0xFFF0D9A8),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                        ),
                      ),
                    ],
                  ),

                  // SYNC STATUS & CONTROLS
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFF121730),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFF262D4A)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: const Color(0xFF1D2340),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: isSyncing
                                  ? const Color(0xFFF0D9A8)
                                  : isError
                                      ? const Color(0xFFEE8F8F)
                                      : const Color(0xFF7FD6A4),
                            ),
                          ),
                          child: Icon(
                            isSyncing
                                ? Icons.autorenew
                                : isError
                                    ? Icons.error_outline
                                    : Icons.check,
                            color: isSyncing
                                ? const Color(0xFFF0D9A8)
                                : isError
                                    ? const Color(0xFFEE8F8F)
                                    : const Color(0xFF7FD6A4),
                            size: 20,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                state.message,
                                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                state.lastSyncTime != null
                                    ? 'Last synced: ${state.lastSyncTime!.hour.toString().padLeft(2, '0')}:${state.lastSyncTime!.minute.toString().padLeft(2, '0')}:${state.lastSyncTime!.second.toString().padLeft(2, '0')}'
                                    : 'Not synced yet',
                                style: GoogleFonts.jetBrainsMono(fontSize: 11, color: const Color(0xFF9099BE)),
                              ),
                            ],
                          ),
                        ),
                        ElevatedButton.icon(
                          onPressed: isSyncing
                              ? null
                              : () async {
                                  await SyncEngine.instance.sync();
                                },
                          icon: isSyncing
                              ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF241D0E)))
                              : const Icon(Icons.sync, size: 16),
                          label: Text(isSyncing ? 'Syncing...' : 'Sync Now', style: const TextStyle(fontSize: 13)),
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                          ),
                        ),
                      ],
                    ),
                  ),

                  if (state.conflicts.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Text('Conflicted Copies (Preserved safely)',
                        style: GoogleFonts.spaceGrotesk(fontSize: 13, fontWeight: FontWeight.w600, color: const Color(0xFFF0D9A8))),
                    const SizedBox(height: 8),
                    Container(
                      constraints: const BoxConstraints(maxHeight: 100),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF121730),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF39426E)),
                      ),
                      child: ListView.builder(
                        shrinkWrap: true,
                        itemCount: state.conflicts.length,
                        itemBuilder: (context, i) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2.0),
                          child: Row(
                            children: [
                              const Icon(Icons.copy, size: 14, color: Color(0xFFF0D9A8)),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  state.conflicts[i],
                                  style: GoogleFonts.jetBrainsMono(fontSize: 11, color: const Color(0xFFE9ECFA)),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
