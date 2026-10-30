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
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF28151D),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF5A2534)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.error_outline, color: Color(0xFFEE8F8F), size: 18),
              const SizedBox(width: 8),
              const Text(
                'Request Failed',
                style: TextStyle(
                  color: Color(0xFFEE8F8F),
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
              const Spacer(),
              if (onDismiss != null)
                IconButton(
                  icon: const Icon(Icons.close, color: Color(0xFFEE8F8F), size: 16),
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
              color: const Color(0xFFFFD4D4),
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
                    const SnackBar(
                      content: Text('Error details copied to clipboard!'),
                      duration: Duration(seconds: 2),
                      backgroundColor: Color(0xFF1D2340),
                    ),
                  );
                }
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xFF3E1D28),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: const Color(0xFF6E2E40)),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.copy, size: 13, color: Color(0xFFEE8F8F)),
                    SizedBox(width: 5),
                    Text(
                      'Copy Error Details',
                      style: TextStyle(fontSize: 11, color: Color(0xFFEE8F8F), fontWeight: FontWeight.w500),
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
