import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:wireguard_flutter/wireguard_flutter_platform_interface.dart';

import '../security/wireguard_identity_store.dart';
import '../security/wireguard_key_generator.dart';

typedef AccessTokenProvider = Future<String> Function();

class DevicePeerConfiguration {
  const DevicePeerConfiguration({
    required this.peerId,
    required this.address,
    required this.serverPublicKey,
    required this.endpoint,
    required this.allowedIps,
  });

  final String peerId;
  final String address;
  final String serverPublicKey;
  final String endpoint;
  final List<String> allowedIps;

  factory DevicePeerConfiguration.fromJson(Map<String, dynamic> json) {
    final allowedIps = json['allowed_ips'];
    if (json['peer_id'] is! String ||
        json['address'] is! String ||
        json['server_public_key'] is! String ||
        json['endpoint'] is! String ||
        allowedIps is! List ||
        allowedIps.any((item) => item is! String)) {
      throw const FormatException(
        'WireGuard configuration response is invalid.',
      );
    }
    return DevicePeerConfiguration(
      peerId: json['peer_id'] as String,
      address: json['address'] as String,
      serverPublicKey: json['server_public_key'] as String,
      endpoint: json['endpoint'] as String,
      allowedIps: allowedIps.cast<String>(),
    );
  }

  String toWgQuickConfig(String privateKey) =>
      '''
[Interface]
PrivateKey = $privateKey
Address = $address

[Peer]
PublicKey = $serverPublicKey
AllowedIPs = ${allowedIps.join(', ')}
PersistentKeepalive = 25
Endpoint = $endpoint
''';
}

class DevicePeerSession {
  const DevicePeerSession({
    required this.id,
    required this.userId,
    required this.deviceId,
    required this.peerId,
    required this.status,
  });

  final String id;
  final String userId;
  final String deviceId;
  final String peerId;
  final String status;

  factory DevicePeerSession.fromJson(Map<String, dynamic> json) {
    if (json['id'] is! String ||
        json['user_id'] is! String ||
        json['device_id'] is! String ||
        json['peer_id'] is! String ||
        json['status'] is! String ||
        json['gateway_mode'] != 'device_peer') {
      throw const FormatException('Device-peer session response is invalid.');
    }
    return DevicePeerSession(
      id: json['id'] as String,
      userId: json['user_id'] as String,
      deviceId: json['device_id'] as String,
      peerId: json['peer_id'] as String,
      status: json['status'] as String,
    );
  }
}

class DevicePeerClient {
  DevicePeerClient({
    required this.apiBaseUri,
    required this.accessTokenProvider,
    WireGuardIdentityVault? identityStore,
    Future<WireGuardKeyPair> Function()? generateKeyPair,
    HttpClient? httpClient,
  }) : _identityStore = identityStore ?? WireGuardIdentityStore(),
       _generateKeyPair = generateKeyPair ?? WireGuardKeyGenerator().generate,
       _httpClient = httpClient ?? HttpClient();

  final Uri apiBaseUri;
  final AccessTokenProvider accessTokenProvider;
  final WireGuardIdentityVault _identityStore;
  final Future<WireGuardKeyPair> Function() _generateKeyPair;
  final HttpClient _httpClient;

  Future<String> enrollDevice({
    required String userId,
    required String deviceName,
    required String platform,
    required String idempotencyKey,
  }) async {
    var identity = await _identityStore.readPending(userId, idempotencyKey);
    if (identity == null) {
      final generated = await _generateKeyPair();
      identity = StoredWireGuardIdentity(
        privateKey: generated.privateKey,
        publicKey: generated.publicKey,
      );
      await _identityStore.savePending(userId, idempotencyKey, identity);
    }

    final device = await _request(
      '/api/v1/devices',
      method: 'POST',
      body: {
        'device_name': deviceName,
        'platform': platform,
        'idempotency_key': idempotencyKey,
      },
    );
    final deviceId = device['id'];
    if (deviceId is! String || device['user_id'] != userId) {
      throw const FormatException('Device registration response is invalid.');
    }

    await _identityStore.save(userId, deviceId, identity);
    await _request(
      '/api/v1/devices/$deviceId/wireguard',
      method: 'POST',
      body: {'public_key': identity.publicKey},
    );
    await _identityStore.clearPending(userId, idempotencyKey);
    return deviceId;
  }

  Future<DevicePeerConfiguration> getConfiguration(String deviceId) async {
    final response = await _request(
      '/api/v1/devices/$deviceId/wireguard/configuration',
    );
    return DevicePeerConfiguration.fromJson(response);
  }

  Future<DevicePeerSession> createSession({
    required String deviceId,
    required String idempotencyKey,
  }) async {
    final response = await _request(
      '/api/v1/device-peer-sessions',
      method: 'POST',
      body: {'device_id': deviceId, 'idempotency_key': idempotencyKey},
    );
    return DevicePeerSession.fromJson(response);
  }

  Future<DevicePeerSession> getSession(String sessionId) async {
    final response = await _request('/api/v1/device-peer-sessions/$sessionId');
    return DevicePeerSession.fromJson(response);
  }

  Future<List<String>> enrolledDeviceIds(String userId) =>
      _identityStore.listDeviceIds(userId);

  Future<DevicePeerSession?> restoreSession({
    required String userId,
    required String deviceId,
  }) async {
    final sessionId = await _identityStore.readSessionId(userId, deviceId);
    if (sessionId == null) return null;
    final session = await getSession(sessionId);
    if (session.userId != userId || session.deviceId != deviceId) {
      throw const FormatException(
        'Restored session ownership does not match this device.',
      );
    }
    if (session.status == 'stopped' || session.status == 'failed') {
      await _identityStore.clearSessionId(userId, deviceId);
    }
    return session;
  }

  Future<DevicePeerSession> connect({
    required String userId,
    required String deviceId,
    required String sessionIdempotencyKey,
    required String interfaceName,
    required String providerBundleIdentifier,
    required WireGuardFlutterInterface tunnel,
  }) async {
    final identity = await _identityStore.read(userId, deviceId);
    if (identity == null) {
      throw StateError('This device has no locally stored WireGuard identity.');
    }
    final session = await createSession(
      deviceId: deviceId,
      idempotencyKey: sessionIdempotencyKey,
    );
    if (session.userId != userId || session.deviceId != deviceId) {
      throw const FormatException(
        'Session ownership does not match this device.',
      );
    }
    await _identityStore.saveSessionId(userId, deviceId, session.id);
    var vpnStartRequested = false;
    try {
      final configuration = await getConfiguration(deviceId);
      if (configuration.peerId != session.peerId) {
        throw const FormatException('Session and WireGuard peer do not match.');
      }

      await tunnel.initialize(interfaceName: interfaceName);
      vpnStartRequested = true;
      await tunnel.startVpn(
        serverAddress: configuration.endpoint,
        wgQuickConfig: configuration.toWgQuickConfig(identity.privateKey),
        providerBundleIdentifier: providerBundleIdentifier,
      );
      final deadline = DateTime.now().add(const Duration(seconds: 20));
      while (DateTime.now().isBefore(deadline)) {
        final current = await getSession(session.id);
        if (current.status == 'connected') return current;
        if (current.status == 'interrupted' ||
            current.status == 'failed' ||
            current.status == 'stopped') {
          throw StateError(
            'The gateway did not verify the device-peer tunnel.',
          );
        }
        await Future<void>.delayed(const Duration(seconds: 1));
      }
      throw TimeoutException('No fresh device-peer handshake was observed.');
    } catch (_) {
      try {
        if (vpnStartRequested && await tunnel.isConnected()) {
          await tunnel.stopVpn();
        }
      } finally {
        await _request(
          '/api/v1/device-peer-sessions/${session.id}/stop',
          method: 'POST',
          body: const {},
        );
      }
      rethrow;
    }
  }

  Future<void> disconnect({
    required String sessionId,
    required WireGuardFlutterInterface tunnel,
  }) async {
    if (await tunnel.isConnected()) await tunnel.stopVpn();
    final response = await _request(
      '/api/v1/device-peer-sessions/$sessionId/stop',
      method: 'POST',
      body: const {},
    );
    final session = DevicePeerSession.fromJson(response);
    if (session.status == 'stopped') {
      await _identityStore.clearSessionId(session.userId, session.deviceId);
    }
  }

  Future<void> revokeDevice(String deviceId, String userId) async {
    final response = await _request(
      '/api/v1/devices/$deviceId/revoke',
      method: 'POST',
      body: const {},
    );
    if (response['status'] != 'revoked') {
      throw const FormatException('Device revocation was not confirmed.');
    }
    await _identityStore.delete(userId, deviceId);
  }

  void close() => _httpClient.close(force: true);

  Future<Map<String, dynamic>> _request(
    String path, {
    String method = 'GET',
    Map<String, Object?>? body,
  }) async {
    final uri = apiBaseUri.resolve(path);
    final parsedHost = InternetAddress.tryParse(uri.host);
    final isLoopback =
        uri.host.toLowerCase() == 'localhost' ||
        (parsedHost?.isLoopback ?? false);
    if (uri.scheme != 'https' && !(uri.scheme == 'http' && isLoopback)) {
      throw StateError('DataPlus API requests require HTTPS.');
    }
    final token = await accessTokenProvider();
    final request = await _httpClient.openUrl(method, uri);
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
    }
    final response = await request.close();
    final text = await utf8.decoder.bind(response).join();
    final decoded = jsonDecode(text);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'DataPlus device-peer request failed (${response.statusCode}).',
      );
    }
    if (decoded is! Map<String, dynamic> ||
        decoded['data'] is! Map<String, dynamic>) {
      throw const FormatException('DataPlus response is invalid.');
    }
    return decoded['data'] as Map<String, dynamic>;
  }
}

String newIdempotencyKey([Random? random]) {
  final source = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => source.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
