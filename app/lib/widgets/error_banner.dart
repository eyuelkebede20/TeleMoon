import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

class ErrorBanner extends StatelessWidget {
  final String error;
  final VoidCallback? onDismiss;

  const ErrorBanner({
    super.key,
    required this.error,
    this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final errColor = isDark ? const Color(0xFFEE8F8F) : const Color(0xFFDC2626);
    final errTextColor = isDark ? const Color(0xFFFFD4D4) : const Color(0xFF991B1B);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF28151D) : const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: isDark ? const Color(0xFF5A2534) : const Color(0xFFFECACA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.error_outline, color: errColor, size: 18),
              const SizedBox(width: 8),
              Text(
                'Request Failed',
                style: TextStyle(
                  color: errColor,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
              const Spacer(),
              if (onDismiss != null)
                IconButton(
                  icon: Icon(Icons.close, color: errColor, size: 16),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: onDismiss,
                ),
            ],
          ),
          const SizedBox(height: 8),
          SelectableText(
            error,
            style: GoogleFonts.jetBrainsMono(
              color: errTextColor,
              fontSize: 12,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: InkWell(
              onTap: () async {
                await Clipboard.setData(ClipboardData(text: error));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: const Text('Error details copied to clipboard!'),
                      duration: const Duration(seconds: 2),
                      backgroundColor: isDark ? const Color(0xFF1D2340) : const Color(0xFF1C1917),
                    ),
                  );
                }
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF3E1D28) : const Color(0xFFFEE2E2),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: isDark ? const Color(0xFF6E2E40) : const Color(0xFFFCA5A5)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.copy, size: 13, color: errColor),
                    const SizedBox(width: 5),
                    Text(
                      'Copy Error Details',
                      style: TextStyle(fontSize: 11, color: errColor, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
