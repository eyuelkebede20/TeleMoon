import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:app/main.dart';
import 'package:app/widgets/error_banner.dart';
import 'package:app/widgets/server_config_dialog.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await ThemeController.instance.init();
  });

  group('TeleMoonApp & Theme Tests', () {
    testWidgets('TeleMoonApp smoke test & theme toggle', (WidgetTester tester) async {
      await tester.pumpWidget(const TeleMoonApp());
      await tester.pumpAndSettle();

      expect(find.text('TeleMoon'), findsWidgets);
      expect(find.text('Enter'), findsOneWidget);

      final initialDark = ThemeController.instance.isDark;
      final themeBtn = find.byTooltip(initialDark ? 'Switch to Creamy Light Mode' : 'Switch to Blue-Black Dark Mode');
      expect(themeBtn, findsOneWidget);

      await tester.tap(themeBtn);
      await tester.pumpAndSettle();

      expect(ThemeController.instance.isDark, !initialDark);

      // Toggle back
      final toggleBackBtn = find.byTooltip(!initialDark ? 'Switch to Creamy Light Mode' : 'Switch to Blue-Black Dark Mode');
      await tester.tap(toggleBackBtn);
      await tester.pumpAndSettle();

      expect(ThemeController.instance.isDark, initialDark);
    });
  });

  group('AuthScreen Tests', () {
    testWidgets('AuthScreen shows validation error on empty credentials', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: const AuthScreen(),
        ),
      );
      await tester.pumpAndSettle();

      final enterBtn = find.widgetWithText(ElevatedButton, 'Enter');
      expect(enterBtn, findsOneWidget);

      await tester.tap(enterBtn);
      await tester.pumpAndSettle();

      expect(find.text('Please enter both handle and password.'), findsOneWidget);
      expect(find.byType(ErrorBanner), findsOneWidget);

      // Test error banner dismiss
      final dismissBtn = find.byIcon(Icons.close);
      expect(dismissBtn, findsOneWidget);
      await tester.tap(dismissBtn);
      await tester.pumpAndSettle();

      expect(find.text('Please enter both handle and password.'), findsNothing);
    });

    testWidgets('AuthScreen text fields accept input', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.light(),
          home: const AuthScreen(),
        ),
      );
      await tester.pumpAndSettle();

      final handleField = find.byType(TextField).first;
      final passField = find.byType(TextField).last;

      await tester.enterText(handleField, 'testuser');
      await tester.enterText(passField, 'secret123');
      await tester.pumpAndSettle();

      expect(find.text('testuser'), findsOneWidget);
    });
  });

  group('ErrorBanner Tests', () {
    testWidgets('ErrorBanner displays error message and invokes dismiss callback', (WidgetTester tester) async {
      bool dismissed = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ErrorBanner(
              error: 'Connection timed out',
              onDismiss: () => dismissed = true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Request Failed'), findsOneWidget);
      expect(find.text('Connection timed out'), findsOneWidget);
      expect(find.text('Copy Error Details'), findsOneWidget);

      final closeBtn = find.byIcon(Icons.close);
      expect(closeBtn, findsOneWidget);
      await tester.tap(closeBtn);
      await tester.pump();

      expect(dismissed, isTrue);
    });
  });

  group('ServerConfigDialog Tests', () {
    testWidgets('ServerConfigDialog displays current base URL and reset button', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ServerConfigDialog(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Server Configuration'), findsOneWidget);
      expect(find.text('Reset Default'), findsOneWidget);
      expect(find.text('Save & Apply'), findsOneWidget);

      // Verify TextField has URL
      final textField = find.byType(TextField);
      expect(textField, findsOneWidget);
    });
  });

  group('LinkStorageScreen Tests', () {
    testWidgets('LinkStorageScreen renders inputs and Telegram dialogs section', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: LinkStorageScreen(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Link Storage'), findsOneWidget);
      expect(find.text('Connect Channel'), findsOneWidget);
      expect(find.text('Telegram Channels & Groups'), findsOneWidget);
      expect(find.byIcon(Icons.refresh), findsOneWidget);
    });
  });
}
