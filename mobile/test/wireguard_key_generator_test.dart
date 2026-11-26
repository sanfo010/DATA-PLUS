import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:dataplus_mobile/security/wireguard_key_generator.dart';

void main() {
  test(
    'generates an X25519 key pair accepted by WireGuard wg pubkey',
    () async {
      final pair = await WireGuardKeyGenerator().generate();
      final privateKeyBytes = base64Decode(pair.privateKey);
      final publicKeyBytes = base64Decode(pair.publicKey);

      expect(privateKeyBytes, hasLength(32));
      expect(publicKeyBytes, hasLength(32));
      expect(privateKeyBytes[0] & 0x07, 0);
      expect(privateKeyBytes[31] & 0x80, 0);
      expect(privateKeyBytes[31] & 0x40, isNonZero);

      final process = await Process.start('wsl.exe', [
        '--distribution',
        'Ubuntu',
        '--',
        'wg',
        'pubkey',
      ]);
      final stdoutFuture = utf8.decoder.bind(process.stdout).join();
      final stderrFuture = utf8.decoder.bind(process.stderr).join();
      final exitCodeFuture = process.exitCode;

      process.stdin.writeln(pair.privateKey);
      await process.stdin.close();

      final derivedPublicKey = await stdoutFuture;
      await stderrFuture;
      final exitCode = await exitCodeFuture;
      expect(
        exitCode,
        0,
        reason: 'WSL wg pubkey must accept the generated key.',
      );
      expect(derivedPublicKey.trim(), pair.publicKey);
    },
    skip: !Platform.isWindows,
  );
}
