import 'dart:convert';
import 'dart:io';

import 'package:dataplus_mobile/device_peers/device_peer_client.dart';
import 'package:dataplus_mobile/security/wireguard_identity_store.dart';
import 'package:dataplus_mobile/security/wireguard_key_generator.dart';
import 'package:flutter_test/flutter_test.dart';

class MemoryIdentityVault implements WireGuardIdentityVault {
  final identities = <String, StoredWireGuardIdentity>{};
  final pending = <String, StoredWireGuardIdentity>{};
  final sessions = <String, String>{};

  @override
  Future<void> save(
    String userId,
    String deviceId,
    StoredWireGuardIdentity identity,
  ) async {
    identities['$userId:$deviceId'] = identity;
  }

  @override
  Future<StoredWireGuardIdentity?> read(String userId, String deviceId) async =>
      identities['$userId:$deviceId'];

  @override
  Future<List<String>> listDeviceIds(String userId) async => identities.keys
      .where((key) => key.startsWith('$userId:'))
      .map((key) => key.substring(userId.length + 1))
      .toList();

  @override
  Future<void> savePending(
    String userId,
    String idempotencyKey,
    StoredWireGuardIdentity identity,
  ) async {
    pending['$userId:$idempotencyKey'] = identity;
  }

  @override
  Future<StoredWireGuardIdentity?> readPending(
    String userId,
    String idempotencyKey,
  ) async => pending['$userId:$idempotencyKey'];

  @override
  Future<void> clearPending(String userId, String idempotencyKey) async {
    pending.remove('$userId:$idempotencyKey');
  }

  @override
  Future<String?> readSessionId(String userId, String deviceId) async =>
      sessions['$userId:$deviceId'];

  @override
  Future<void> saveSessionId(
    String userId,
    String deviceId,
    String sessionId,
  ) async {
    sessions['$userId:$deviceId'] = sessionId;
  }

  @override
  Future<void> clearSessionId(String userId, String deviceId) async {
    sessions.remove('$userId:$deviceId');
  }

  @override
  Future<void> delete(String userId, String deviceId) async {
    identities.remove('$userId:$deviceId');
    sessions.remove('$userId:$deviceId');
  }
}

void main() {
  test(
    'device-peer API refuses to send bearer tokens over public HTTP',
    () async {
      var tokenRequested = false;
      final client = DevicePeerClient(
        apiBaseUri: Uri.parse('http://dataplus.example.test'),
        accessTokenProvider: () async {
          tokenRequested = true;
          return 'test-token';
        },
      );

      try {
        await expectLater(
          client.getSession('10000000-0000-4000-8000-000000000001'),
          throwsA(isA<StateError>()),
        );
        expect(tokenRequested, isFalse);
      } finally {
        client.close();
      }
    },
  );

  test(
    'enrollment sends only the public key and keeps private key local',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final receivedBodies = <String, Map<String, dynamic>>{};
      final serverDone = server.listen((request) async {
        expect(
          request.headers.value(HttpHeaders.authorizationHeader),
          'Bearer test-token',
        );
        final bodyText = await utf8.decoder.bind(request).join();
        if (bodyText.isNotEmpty) {
          receivedBodies[request.uri.path] =
              jsonDecode(bodyText) as Map<String, dynamic>;
        }

        request.response.headers.contentType = ContentType.json;
        if (request.uri.path == '/api/v1/devices') {
          request.response.write(
            jsonEncode({
              'data': {
                'id': '10000000-0000-4000-8000-000000000001',
                'user_id': '00000000-0000-4000-8000-000000000001',
              },
            }),
          );
        } else {
          request.response.write(
            jsonEncode({
              'data': {'status': 'active'},
            }),
          );
        }
        await request.response.close();
      });

      final vault = MemoryIdentityVault();
      final client = DevicePeerClient(
        apiBaseUri: Uri.parse('http://127.0.0.1:${server.port}'),
        accessTokenProvider: () async => 'test-token',
        identityStore: vault,
        generateKeyPair: () async => const WireGuardKeyPair(
          privateKey: 'local-private-key',
          publicKey: 'only-public-key',
        ),
      );

      try {
        final deviceId = await client.enrollDevice(
          userId: '00000000-0000-4000-8000-000000000001',
          deviceName: 'Local test phone',
          platform: 'android',
          idempotencyKey: '20000000-0000-4000-8000-000000000001',
        );

        expect(deviceId, '10000000-0000-4000-8000-000000000001');
        expect(
          receivedBodies['/api/v1/devices/10000000-0000-4000-8000-000000000001/wireguard'],
          {'public_key': 'only-public-key'},
        );
        expect(
          jsonEncode(receivedBodies).contains('local-private-key'),
          isFalse,
        );
        expect(
          (await vault.read(
            '00000000-0000-4000-8000-000000000001',
            deviceId,
          ))?.privateKey,
          'local-private-key',
        );
        expect(
          await client.enrolledDeviceIds(
            '00000000-0000-4000-8000-000000000001',
          ),
          [deviceId],
        );
      } finally {
        client.close();
        server.close(force: true);
        serverDone.cancel();
      }
    },
  );
}
