import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../api_service.dart';

class ServerConfigDialog extends StatefulWidget {
  const ServerConfigDialog({super.key});

  @override
  State<ServerConfigDialog> createState() => _ServerConfigDialogState();
}

class _ServerConfigDialogState extends State<ServerConfigDialog> {
  final _urlController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _urlController.text = ApiService().baseUrl;
  }

  Future<void> _save() async {
    final url = _urlController.text.trim();
    if (url.isNotEmpty) {
      await ApiService().setBaseUrl(url);
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _reset() async {
    await ApiService().resetBaseUrl();
    setState(() {
      _urlController.text = ApiService().baseUrl;
    });
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: const Color(0xFF171C30),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFF262D4A)),
      ),
      child: Container(
        width: 440,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.dns, color: Color(0xFFF0D9A8), size: 22),
                const SizedBox(width: 10),
                const Text(
                  'Server Configuration',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close, color: Color(0xFF9099BE), size: 20),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'Set the TeleMoon backend API URL. Useful when connecting from a physical phone, emulator, or custom host.',
              style: TextStyle(color: Color(0xFF9099BE), fontSize: 12),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _urlController,
              style: GoogleFonts.jetBrainsMono(fontSize: 13),
              decoration: const InputDecoration(
                hintText: 'https://telemoon.ethiodeploy.com/api',
                prefixIcon: Icon(Icons.link, color: Color(0xFF9099BE), size: 18),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Default: https://telemoon.ethiodeploy.com/api',
              style: GoogleFonts.jetBrainsMono(fontSize: 10, color: const Color(0xFF6E78A0)),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: _reset,
                  child: const Text('Reset Default', style: TextStyle(color: Color(0xFF9099BE))),
                ),
                const SizedBox(width: 10),
                ElevatedButton(
                  onPressed: _save,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                  ),
                  child: const Text('Save & Apply', style: TextStyle(fontSize: 13)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
