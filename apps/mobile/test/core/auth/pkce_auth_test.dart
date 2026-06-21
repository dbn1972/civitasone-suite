import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';

class MockFlutterAppAuth extends Mock implements FlutterAppAuth {}
class MockFlutterSecureStorage extends Mock implements FlutterSecureStorage {}

class _FakeTokenResponse extends Fake implements TokenResponse {
  _FakeTokenResponse({
    required this.accessToken,
    this.refreshToken,
    this.accessTokenExpirationDateTime,
  });

  @override
  final String? accessToken;
  @override
  final String? refreshToken;
  @override
  final DateTime? accessTokenExpirationDateTime;
}

void main() {
  late MockFlutterAppAuth mockAppAuth;
  late MockFlutterSecureStorage mockStorage;
  late PkceAuthService auth;

  setUpAll(() {
    registerFallbackValue(AuthorizationTokenRequest('', ''));
    registerFallbackValue(TokenRequest('', ''));
  });

  setUp(() {
    mockAppAuth = MockFlutterAppAuth();
    mockStorage = MockFlutterSecureStorage();
    auth = PkceAuthService(appAuth: mockAppAuth, storage: mockStorage);
  });

  group('accessToken', () {
    test('returns null when no token stored', () async {
      when(() => mockStorage.read(key: 'civitasone_at'))
          .thenAnswer((_) async => null);

      expect(await auth.accessToken(), isNull);
    });

    test('returns stored token when not expired', () async {
      when(() => mockStorage.read(key: 'civitasone_at'))
          .thenAnswer((_) async => 'valid-token');
      when(() => mockStorage.read(key: 'civitasone_at_exp')).thenAnswer((_) async =>
          DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String());

      expect(await auth.accessToken(), 'valid-token');
    });

    test('refreshes transparently when token is expired', () async {
      when(() => mockStorage.read(key: 'civitasone_at'))
          .thenAnswer((_) async => 'expired-token');
      when(() => mockStorage.read(key: 'civitasone_at_exp')).thenAnswer((_) async =>
          DateTime.now()
              .subtract(const Duration(minutes: 5))
              .toUtc()
              .toIso8601String());
      when(() => mockStorage.read(key: 'civitasone_rt'))
          .thenAnswer((_) async => 'refresh-token-123');
      when(() => mockAppAuth.token(any())).thenAnswer((_) async =>
          _FakeTokenResponse(
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            accessTokenExpirationDateTime:
                DateTime.now().add(const Duration(hours: 1)),
          ));
      when(() => mockStorage.write(
              key: any(named: 'key'), value: any(named: 'value')))
          .thenAnswer((_) async {});

      expect(await auth.accessToken(), 'new-access-token');
      verify(() => mockAppAuth.token(any())).called(1);
    });

    test('returns null and signs out when no refresh token', () async {
      when(() => mockStorage.read(key: 'civitasone_at'))
          .thenAnswer((_) async => 'expired-token');
      when(() => mockStorage.read(key: 'civitasone_at_exp')).thenAnswer((_) async =>
          DateTime.now()
              .subtract(const Duration(hours: 2))
              .toUtc()
              .toIso8601String());
      when(() => mockStorage.read(key: 'civitasone_rt'))
          .thenAnswer((_) async => null);
      when(() => mockStorage.delete(key: any(named: 'key')))
          .thenAnswer((_) async {});

      expect(await auth.accessToken(), isNull);
      verify(() => mockStorage.delete(key: 'civitasone_at')).called(1);
    });

    test('signs out when refresh call throws (refresh token revoked)', () async {
      when(() => mockStorage.read(key: 'civitasone_at'))
          .thenAnswer((_) async => 'expired-token');
      when(() => mockStorage.read(key: 'civitasone_at_exp')).thenAnswer((_) async =>
          DateTime.now()
              .subtract(const Duration(hours: 2))
              .toUtc()
              .toIso8601String());
      when(() => mockStorage.read(key: 'civitasone_rt'))
          .thenAnswer((_) async => 'stale-rt');
      when(() => mockAppAuth.token(any()))
          .thenThrow(Exception('token_expired'));
      when(() => mockStorage.delete(key: any(named: 'key')))
          .thenAnswer((_) async {});

      expect(await auth.accessToken(), isNull);
      verify(() => mockStorage.delete(key: 'civitasone_at')).called(1);
    });
  });

  group('signOut', () {
    test('deletes access, refresh, and expiry keys', () async {
      when(() => mockStorage.delete(key: any(named: 'key')))
          .thenAnswer((_) async {});

      await auth.signOut();

      verify(() => mockStorage.delete(key: 'civitasone_at')).called(1);
      verify(() => mockStorage.delete(key: 'civitasone_rt')).called(1);
      verify(() => mockStorage.delete(key: 'civitasone_at_exp')).called(1);
    });
  });
}
