# DataPlus mobile

The app uses Supabase password authentication and the authenticated DataPlus
device-peer API. Runtime configuration is supplied at build/run time; never add
the server `service_role` key to Flutter defines or mobile files.

Required compile-time values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (the public client key only)
- `DATAPLUS_API_BASE_URL`

For example, provide these values through your local Flutter launch
configuration or `--dart-define` arguments. The API URL must use HTTPS except
for loopback addresses used by local tests.

After signing in, the app can enroll this installation, retain its WireGuard
identity in platform secure storage, start a tunnel, restore the associated
session, and revoke the device. Only Android VPN startup is enabled until the
iOS Packet Tunnel extension target, Network Extension entitlement, bundle ID,
and signing configuration are added and verified in Xcode.

The client considers a tunnel connected only after the backend observes a
fresh WireGuard handshake. The current lab configuration routes only the lab
subnet; it does not provide general Internet access.

Run local checks with `flutter test` and `flutter analyze`. No private key,
service-role key, or user credential belongs in the repository or logs.
