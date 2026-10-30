import 'package:flutter_test/flutter_test.dart';
import 'package:app/main.dart';

void main() {
  testWidgets('TeleMoonApp smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const TeleMoonApp());
    expect(find.text('TeleMoon'), findsWidgets);
  });
}
