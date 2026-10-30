import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;

class ScannedItem {
  final String relPath;
  final bool isDirectory;
  final int size;
  final int mtimeMs;
  final String? hash;

  ScannedItem({
    required this.relPath,
    required this.isDirectory,
    required this.size,
    required this.mtimeMs,
    this.hash,
  });
}

class LocalScanner {
  static const Set<String> ignoredDirNames = {
    '.git',
    '.telemoon-tmp',
    '.dart_tool',
    'node_modules',
    '\$RECYCLE.BIN',
    'System Volume Information',
  };

  static bool isIgnored(String name, {bool isDir = false}) {
    if (name.startsWith('~\$')) return true; // Office temp locks
    if (name.endsWith('.tmp') || name.endsWith('.swp')) return true;
    if (name == 'desktop.ini' || name == 'Thumbs.db') return true;
    if (isDir && ignoredDirNames.contains(name)) return true;
    if (name.startsWith('.') && name != '.telemoonignore') return true;
    return false;
  }

  /// Recursively scan the root directory and compute metadata & hashes.
  static Future<Map<String, ScannedItem>> scan(
    Directory rootDir, {
    Map<String, ScannedItem>? previousScan,
  }) async {
    final result = <String, ScannedItem>{};
    if (!await rootDir.exists()) return result;

    final rootPath = rootDir.path;

    await for (final entity in rootDir.list(recursive: true, followLinks: false)) {
      final isDir = entity is Directory;

      // Check ignore for any component of the path
      final rel = p.relative(entity.path, from: rootPath).replaceAll('\\', '/');
      final parts = rel.split('/');
      if (parts.any((part) => isIgnored(part, isDir: isDir))) {
        continue;
      }

      final stat = await entity.stat();
      if (stat.type == FileSystemEntityType.link) {
        continue; // Never follow symlinks/junctions
      }

      if (isDir) {
        result[rel] = ScannedItem(
          relPath: rel,
          isDirectory: true,
          size: 0,
          mtimeMs: stat.modified.millisecondsSinceEpoch,
        );
      } else if (entity is File) {
        String? hash;
        final prev = previousScan?[rel];

        // Optimize: If size and mtime are unchanged, reuse cached hash
        if (prev != null &&
            prev.size == stat.size &&
            prev.mtimeMs == stat.modified.millisecondsSinceEpoch &&
            prev.hash != null) {
          hash = prev.hash;
        } else {
          try {
            hash = await _computeSha256(entity);
          } catch (_) {
            // Locked file or reading error: skip hashing for now
            hash = null;
          }
        }

        result[rel] = ScannedItem(
          relPath: rel,
          isDirectory: false,
          size: stat.size,
          mtimeMs: stat.modified.millisecondsSinceEpoch,
          hash: hash,
        );
      }
    }

    return result;
  }

  static Future<String> _computeSha256(File file) async {
    final digest = await sha256.bind(file.openRead()).first;
    return digest.toString();
  }
}
