import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredWireGuardIdentity {
  const StoredWireGuardIdentity({
    required this.privateKey,
    required this.publicKey,
  });

  final String privateKey;
  final String publicKey;
}

abstract interface class WireGuardIdentityVault {
  Future<void> save(
    String userId,
    String deviceId,
    StoredWireGuardIdentity identity,
  );
  Future<StoredWireGuardIdentity?> read(String userId, String deviceId);
  Future<List<String>> listDeviceIds(String userId);
  Future<void> savePending(
    String userId,
    String idempotencyKey,
    StoredWireGuardIdentity identity,
  );
  Future<StoredWireGuardIdentity?> readPending(
    String userId,
    String idempotencyKey,
  );
  Future<void> clearPending(String userId, String idempotencyKey);
  Future<String?> readSessionId(String userId, String deviceId);
  Future<void> saveSessionId(String userId, String deviceId, String sessionId);
  Future<void> clearSessionId(String userId, String deviceId);
  Future<void> delete(String userId, String deviceId);
}

class WireGuardIdentityStore implements WireGuardIdentityVault {
  WireGuardIdentityStore({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(
              resetOnError: false,
              migrateWithBackup: false,
            ),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.unlocked_this_device,
              synchronizable: false,
            ),
          );

  final FlutterSecureStorage _storage;

  String _identityKey(String userId, String deviceId) =>
      'wireguard.identity.$userId.$deviceId';

  String _pendingKey(String userId, String idempotencyKey) =>
      'wireguard.pending.$userId.$idempotencyKey';

  String _deviceListKey(String userId) => 'wireguard.devices.$userId';

  String _sessionKey(String userId, String deviceId) =>
      'wireguard.session.$userId.$deviceId';

  @override
  Future<void> save(
    String userId,
    String deviceId,
    StoredWireGuardIdentity identity,
  ) async {
    await _storage.write(
      key: _identityKey(userId, deviceId),
      value: jsonEncode({
        'private_key': identity.privateKey,
        'public_key': identity.publicKey,
      }),
    );
    final deviceIds = await listDeviceIds(userId);
    if (!deviceIds.contains(deviceId)) {
      await _storage.write(
        key: _deviceListKey(userId),
        value: jsonEncode([...deviceIds, deviceId]),
      );
    }
  }

  @override
  Future<List<String>> listDeviceIds(String userId) async {
    final value = await _storage.read(key: _deviceListKey(userId));
    if (value == null) return const [];
    final decoded = jsonDecode(value);
    if (decoded is! List || decoded.any((item) => item is! String)) {
      throw const FormatException('Stored WireGuard device index is invalid.');
    }
    return decoded.cast<String>();
  }

  @override
  Future<StoredWireGuardIdentity?> read(String userId, String deviceId) async {
    final value = await _storage.read(key: _identityKey(userId, deviceId));
    if (value == null) return null;
    final decoded = jsonDecode(value);
    if (decoded is! Map<String, dynamic> ||
        decoded['private_key'] is! String ||
        decoded['public_key'] is! String) {
      throw const FormatException('Stored WireGuard identity is invalid.');
    }
    return StoredWireGuardIdentity(
      privateKey: decoded['private_key'] as String,
      publicKey: decoded['public_key'] as String,
    );
  }

  @override
  Future<void> savePending(
    String userId,
    String idempotencyKey,
    StoredWireGuardIdentity identity,
  ) async {
    await _storage.write(
      key: _pendingKey(userId, idempotencyKey),
      value: jsonEncode({
        'private_key': identity.privateKey,
        'public_key': identity.publicKey,
      }),
    );
  }

  @override
  Future<StoredWireGuardIdentity?> readPending(
    String userId,
    String idempotencyKey,
  ) async {
    final value = await _storage.read(key: _pendingKey(userId, idempotencyKey));
    if (value == null) return null;
    final decoded = jsonDecode(value);
    if (decoded is! Map<String, dynamic> ||
        decoded['private_key'] is! String ||
        decoded['public_key'] is! String) {
      throw const FormatException('Pending WireGuard identity is invalid.');
    }
    return StoredWireGuardIdentity(
      privateKey: decoded['private_key'] as String,
      publicKey: decoded['public_key'] as String,
    );
  }

  @override
  Future<void> clearPending(String userId, String idempotencyKey) =>
      _storage.delete(key: _pendingKey(userId, idempotencyKey));

  @override
  Future<String?> readSessionId(String userId, String deviceId) =>
      _storage.read(key: _sessionKey(userId, deviceId));

  @override
  Future<void> saveSessionId(
    String userId,
    String deviceId,
    String sessionId,
  ) => _storage.write(key: _sessionKey(userId, deviceId), value: sessionId);

  @override
  Future<void> clearSessionId(String userId, String deviceId) =>
      _storage.delete(key: _sessionKey(userId, deviceId));

  @override
  Future<void> delete(String userId, String deviceId) async {
    await _storage.delete(key: _identityKey(userId, deviceId));
    await clearSessionId(userId, deviceId);
    final deviceIds = await listDeviceIds(userId);
    deviceIds.remove(deviceId);
    await _storage.write(
      key: _deviceListKey(userId),
      value: jsonEncode(deviceIds),
    );
  }
}
