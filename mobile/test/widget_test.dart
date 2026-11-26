import 'package:dataplus_mobile/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'shows safe setup guidance when runtime configuration is absent',
    (tester) async {
      await tester.pumpWidget(const DataPlusApp(configurationReady: false));

      expect(find.text('Configuration requise'), findsOneWidget);
      expect(find.textContaining('SUPABASE_SERVICE_ROLE_KEY'), findsNothing);
      expect(find.textContaining('SUPABASE_URL'), findsOneWidget);
    },
  );
}
