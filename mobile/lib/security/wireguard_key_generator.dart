import 'dart:convert';

import 'package:cryptography/cryptography.dart';

class WireGuardKeyPair {
  const WireGuardKeyPair({required this.privateKey, required this.publicKey});

  final String privateKey;
  final String publicKey;
}

class WireGuardKeyGenerator {
  WireGuardKeyGenerator({X25519? algorithm})
    : _algorithm = algorithm ?? X25519();

  final X25519 _algorithm;

  Future<WireGuardKeyPair> generate() async {
    final keyPair = await _algorithm.newKeyPair();
    try {
      final privateKeyBytes = await keyPair.extractPrivateKeyBytes();
      final publicKey = await keyPair.extractPublicKey();
      if (privateKeyBytes.length != 32 || publicKey.bytes.length != 32) {
        throw StateError('X25519 keys must be 32 bytes.');
      }
      if (privateKeyBytes[0] & 0x07 != 0 ||
          privateKeyBytes[31] & 0x80 != 0 ||
          privateKeyBytes[31] & 0x40 == 0) {
        throw StateError('X25519 private key is not in WireGuard form.');
      }

      return WireGuardKeyPair(
        privateKey: base64Encode(privateKeyBytes),
        publicKey: base64Encode(publicKey.bytes),
      );
    } finally {
      keyPair.destroy();
    }
  }
}
