import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:wireguard_flutter/wireguard_flutter.dart';
import 'package:wireguard_flutter/wireguard_flutter_platform_interface.dart';

import 'device_peers/device_peer_client.dart';

const _supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const _supabasePublicKey = String.fromEnvironment('SUPABASE_ANON_KEY');
const _apiBaseUrl = String.fromEnvironment('DATAPLUS_API_BASE_URL');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final apiUri = Uri.tryParse(_apiBaseUrl);
  final supabaseUri = Uri.tryParse(_supabaseUrl);
  if (_supabaseUrl.isEmpty ||
      _supabasePublicKey.isEmpty ||
      supabaseUri == null ||
      !_isSecureApiUri(supabaseUri) ||
      apiUri == null ||
      !_isSecureApiUri(apiUri)) {
    runApp(const DataPlusApp(configurationReady: false));
    return;
  }

  try {
    await Supabase.initialize(
      url: _supabaseUrl,
      publishableKey: _supabasePublicKey,
    );
    runApp(DataPlusApp(configurationReady: true, apiBaseUri: apiUri));
  } catch (_) {
    runApp(const DataPlusApp(configurationReady: false));
  }
}

bool _isSecureApiUri(Uri uri) {
  if (uri.scheme == 'https' && uri.hasAuthority) return true;
  final host = uri.host;
  return uri.scheme == 'http' &&
      uri.hasAuthority &&
      (host.toLowerCase() == 'localhost' ||
          (InternetAddress.tryParse(host)?.isLoopback ?? false));
}

class DataPlusApp extends StatelessWidget {
  const DataPlusApp({
    super.key,
    required this.configurationReady,
    this.apiBaseUri,
  });

  final bool configurationReady;
  final Uri? apiBaseUri;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DataPlus',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF12385B),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFF3F7FA),
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
      ),
      home: configurationReady && apiBaseUri != null
          ? const _AuthenticationGate()
          : const _ConfigurationScreen(),
    );
  }
}

class _ConfigurationScreen extends StatelessWidget {
  const _ConfigurationScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _BrandMark(),
                  const SizedBox(height: 28),
                  Text(
                    'Configuration requise',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Fournissez SUPABASE_URL, SUPABASE_ANON_KEY et '
                    'DATAPLUS_API_BASE_URL au lancement. Utilisez HTTPS '
                    'pour toute adresse autre que localhost.',
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthenticationGate extends StatefulWidget {
  const _AuthenticationGate();

  @override
  State<_AuthenticationGate> createState() => _AuthenticationGateState();
}

class _AuthenticationGateState extends State<_AuthenticationGate> {
  late Session? _session = Supabase.instance.client.auth.currentSession;
  late final StreamSubscription<AuthState> _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = Supabase.instance.client.auth.onAuthStateChange.listen((
      state,
    ) {
      if (mounted) setState(() => _session = state.session);
    });
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final apiBaseUri = Uri.parse(_apiBaseUrl);
    final session = _session;
    if (session == null) return const _SignInScreen();
    return _DevicePeerScreen(
      userId: session.user.id,
      apiBaseUri: apiBaseUri,
      signOut: () => Supabase.instance.client.auth.signOut(),
    );
  }
}

class _SignInScreen extends StatefulWidget {
  const _SignInScreen();

  @override
  State<_SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<_SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Supabase.instance.client.auth.signInWithPassword(
        email: _email.text.trim(),
        password: _password.text,
      );
    } on AuthException {
      if (mounted) setState(() => _error = 'Identifiants invalides.');
    } catch (_) {
      if (mounted) setState(() => _error = 'Connexion impossible. Réessayez.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _BrandMark(),
                  const SizedBox(height: 36),
                  Text(
                    'Prépare ta connexion.',
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text('Connectez-vous pour gérer vos appareils.'),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username],
                    decoration: const InputDecoration(labelText: 'E-mail'),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    onSubmitted: (_) => _busy ? null : _signIn(),
                    decoration: const InputDecoration(
                      labelText: 'Mot de passe',
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  FilledButton(
                    onPressed: _busy ? null : _signIn,
                    child: Text(_busy ? 'Connexion…' : 'Se connecter'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DevicePeerScreen extends StatefulWidget {
  const _DevicePeerScreen({
    required this.userId,
    required this.apiBaseUri,
    required this.signOut,
  });

  final String userId;
  final Uri apiBaseUri;
  final Future<void> Function() signOut;

  @override
  State<_DevicePeerScreen> createState() => _DevicePeerScreenState();
}

class _DevicePeerScreenState extends State<_DevicePeerScreen> {
  late final DevicePeerClient _client = DevicePeerClient(
    apiBaseUri: widget.apiBaseUri,
    accessTokenProvider: () async {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      if (token == null || token.isEmpty) {
        throw StateError('A current Supabase session is required.');
      }
      return token;
    },
  );
  late final WireGuardFlutterInterface _tunnel = WireGuardFlutter.instance;
  final _deviceName = TextEditingController(text: 'DataPlus mobile');
  List<String> _deviceIds = const [];
  String? _selectedDeviceId;
  DevicePeerSession? _session;
  Timer? _pollTimer;
  bool _busy = false;
  String? _message;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadDevices());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _deviceName.dispose();
    _client.close();
    super.dispose();
  }

  Future<void> _loadDevices() async {
    try {
      final devices = await _client.enrolledDeviceIds(widget.userId);
      if (!mounted) return;
      setState(() {
        _deviceIds = devices;
        _selectedDeviceId = devices.isEmpty ? null : devices.last;
      });
      if (_selectedDeviceId != null) await _restoreSession();
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Impossible de lire les identités locales.');
      }
    }
  }

  Future<void> _restoreSession() async {
    final deviceId = _selectedDeviceId;
    if (deviceId == null) return;
    try {
      final session = await _client.restoreSession(
        userId: widget.userId,
        deviceId: deviceId,
      );
      if (!mounted) return;
      setState(() {
        _session = session;
        _error = null;
      });
      _startPolling();
    } on HttpException {
      if (mounted) {
        setState(
          () => _error = 'La session n’est pas accessible sur le serveur.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'La restauration de session a échoué.');
      }
    }
  }

  Future<void> _enroll() => _run(() async {
    if (!Platform.isAndroid && !Platform.isIOS) {
      throw StateError('Le VPN natif est disponible sur Android et iOS.');
    }
    final deviceId = await _client.enrollDevice(
      userId: widget.userId,
      deviceName: _deviceName.text.trim(),
      platform: Platform.isAndroid ? 'android' : 'ios',
      idempotencyKey: newIdempotencyKey(),
    );
    final devices = await _client.enrolledDeviceIds(widget.userId);
    if (!mounted) return;
    setState(() {
      _deviceIds = devices;
      _selectedDeviceId = deviceId;
      _session = null;
      _message = 'Appareil enrôlé. La clé privée reste sur cet appareil.';
    });
  });

  Future<void> _connect() => _run(() async {
    if (!Platform.isAndroid) {
      throw StateError(
        Platform.isIOS
            ? 'La cible iOS Packet Tunnel et sa signature ne sont pas configurées.'
            : 'Cette plateforme ne prend pas en charge le VPN natif.',
      );
    }
    final deviceId = _selectedDeviceId;
    if (deviceId == null) throw StateError('Enrôlez d’abord cet appareil.');
    final session = await _client.connect(
      userId: widget.userId,
      deviceId: deviceId,
      sessionIdempotencyKey: newIdempotencyKey(),
      interfaceName: 'DataPlus',
      providerBundleIdentifier: '',
      tunnel: _tunnel,
    );
    if (!mounted) return;
    setState(() {
      _session = session;
      _message = 'Tunnel confirmé par une poignée de main WireGuard récente.';
    });
    _startPolling();
  });

  Future<void> _disconnect() => _run(() async {
    final session = _session;
    if (session == null) return;
    await _client.disconnect(sessionId: session.id, tunnel: _tunnel);
    final updated = await _client.restoreSession(
      userId: widget.userId,
      deviceId: session.deviceId,
    );
    if (!mounted) return;
    setState(() {
      _session = updated;
      _message = updated?.status == 'stopping'
          ? 'Arrêt demandé; confirmation passerelle en attente.'
          : 'Session arrêtée.';
    });
    _startPolling();
  });

  Future<void> _revoke() => _run(() async {
    final deviceId = _selectedDeviceId;
    if (deviceId == null) return;
    final session = _session;
    if (session != null) {
      await _client.disconnect(sessionId: session.id, tunnel: _tunnel);
    }
    await _client.revokeDevice(deviceId, widget.userId);
    if (!mounted) return;
    setState(() {
      _deviceIds = _deviceIds.where((id) => id != deviceId).toList();
      _selectedDeviceId = _deviceIds.isEmpty ? null : _deviceIds.last;
      _session = null;
      _message = 'Appareil révoqué; sa clé locale a été effacée.';
    });
    _startPolling();
  });

  Future<void> _signOut() async {
    try {
      final session = _session;
      if (session != null && session.status != 'stopped') {
        await _client.disconnect(sessionId: session.id, tunnel: _tunnel);
      }
      await widget.signOut();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Déconnexion VPN impossible; session conservée.',
        );
      }
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on StateError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } on HttpException catch (error) {
      if (mounted) {
        setState(() => _error = 'API inaccessible (${error.message}).');
      }
    } on TimeoutException {
      if (mounted) {
        setState(() => _error = 'Aucune poignée de main WireGuard confirmée.');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Opération échouée; aucun secret journalisé.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    if (_session == null || _session!.status == 'stopped') return;
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_busy || !mounted || _session == null) return;
      try {
        final updated = await _client.getSession(_session!.id);
        if (!mounted) return;
        setState(() => _session = updated);
        if (updated.status == 'stopped' || updated.status == 'failed') {
          _pollTimer?.cancel();
        }
      } catch (_) {
        if (!mounted) return;
        setState(() => _error = 'État de session temporairement indisponible.');
      }
    });
  }

  String _statusLabel(String? status) => switch (status) {
    'connected' => 'Connecté · poignée de main confirmée',
    'connecting' => 'Connexion en cours',
    'stopping' => 'Arrêt en attente de confirmation',
    'interrupted' => 'Interrompu · reconnexion possible',
    'failed' => 'Échec',
    'stopped' => 'Déconnecté',
    _ => 'Aucune session active',
  };

  @override
  Widget build(BuildContext context) {
    final session = _session;
    return Scaffold(
      appBar: AppBar(
        title: const Text('DataPlus'),
        actions: [
          IconButton(
            tooltip: 'Se déconnecter',
            onPressed: _busy ? null : _signOut,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Votre connexion, prête à partir.',
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            const Text(
              'Enrôlez cet appareil puis établissez un tunnel WireGuard '
              'authentifié.',
            ),
            const SizedBox(height: 20),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.lock_outline),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'La clé privée est conservée dans le coffre sécurisé '
                        'de l’appareil et n’est jamais envoyée au backend.',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (_deviceIds.isEmpty) ...[
              TextField(
                controller: _deviceName,
                decoration: const InputDecoration(
                  labelText: 'Nom de cet appareil',
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _busy ? null : _enroll,
                icon: const Icon(Icons.phonelink_setup),
                label: Text(_busy ? 'Enrôlement…' : 'Enrôler cet appareil'),
              ),
            ] else ...[
              DropdownButtonFormField<String>(
                initialValue: _selectedDeviceId,
                decoration: const InputDecoration(labelText: 'Appareil local'),
                items: _deviceIds
                    .map(
                      (id) => DropdownMenuItem(
                        value: id,
                        child: Text('…${id.substring(id.length - 8)}'),
                      ),
                    )
                    .toList(),
                onChanged: _busy
                    ? null
                    : (id) {
                        setState(() {
                          _selectedDeviceId = id;
                          _session = null;
                        });
                        unawaited(_restoreSession());
                      },
              ),
              const SizedBox(height: 14),
              Card(
                child: ListTile(
                  leading: Icon(
                    session?.status == 'connected'
                        ? Icons.verified
                        : Icons.shield_outlined,
                  ),
                  title: Text(_statusLabel(session?.status)),
                  subtitle: session == null
                      ? null
                      : Text(
                          'Session …${session.id.substring(session.id.length - 8)}',
                        ),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _busy
                    ? null
                    : session?.status == 'connected' ||
                          session?.status == 'stopping'
                    ? _disconnect
                    : _connect,
                icon: Icon(
                  session?.status == 'connected' ||
                          session?.status == 'stopping'
                      ? Icons.link_off
                      : Icons.link,
                ),
                label: Text(
                  _busy
                      ? 'Veuillez patienter…'
                      : session?.status == 'connected' ||
                            session?.status == 'stopping'
                      ? 'Déconnecter'
                      : 'Connecter',
                ),
              ),
              OutlinedButton.icon(
                onPressed: _busy ? null : _revoke,
                icon: const Icon(Icons.delete_outline),
                label: const Text('Révoquer cet appareil'),
              ),
            ],
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(_message!),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primary,
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Icon(Icons.wifi_tethering, color: Colors.white),
        ),
        const SizedBox(width: 12),
        Text(
          'DataPlus',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}
