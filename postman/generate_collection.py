import json, sys, uuid
# Regenerates CineReserva.postman_collection.json: python3 postman/generate_collection.py postman

out_dir = sys.argv[1]

def script(lines):
    return [{"listen": "test", "script": {"type": "text/javascript", "exec": lines}}]

def status_test(code):
    return [f"pm.test('status is {code}', () => pm.response.to.have.status({code}));"]

def req(name, method, path, body=None, token=None, tests=None, query=None, desc=None):
    url_raw = "{{baseUrl}}" + path
    url = {"raw": url_raw, "host": ["{{baseUrl}}"], "path": [p for p in path.strip("/").split("/") if p]}
    if query:
        url["query"] = [{"key": k, "value": v} for k, v in query]
        url["raw"] += "?" + "&".join(f"{k}={v}" for k, v in query)
    r = {"method": method, "header": [], "url": url}
    if desc:
        r["description"] = desc
    if body is not None:
        r["header"].append({"key": "Content-Type", "value": "application/json"})
        r["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2), "options": {"raw": {"language": "json"}}}
    if token:
        r["auth"] = {"type": "bearer", "bearer": [{"key": "token", "value": "{{" + token + "}}", "type": "string"}]}
    else:
        r["auth"] = {"type": "noauth"}
    item = {"name": name, "request": r}
    if tests:
        item["event"] = script(tests)
    return item

def save(var, expr):
    return [f"const body = pm.response.json();", f"if ({expr.split('.')[0]} !== undefined) pm.collectionVariables.set('{var}', {expr});"]

def saving(code, pairs):
    lines = status_test(code) + ["const body = pm.response.json();"]
    for var, expr in pairs:
        lines.append(f"if ({expr} !== undefined) pm.collectionVariables.set('{var}', {expr});")
    return lines

TOTP_SCRIPT = [
    "// RFC 6238 TOTP (SHA1, 6 digits, 30s) computed from the secret saved by 'Generate 2FA secret'.",
    "const hmacLib = require('crypto-js');",
    "const secret = pm.collectionVariables.get('twoFactorSecret') || '';",
    "const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';",
    "let bits = '';",
    "for (const c of secret.replace(/=+$/, '').toUpperCase()) {",
    "  const v = alphabet.indexOf(c);",
    "  if (v >= 0) bits += v.toString(2).padStart(5, '0');",
    "}",
    "let keyHex = '';",
    "for (let i = 0; i + 8 <= bits.length; i += 8) keyHex += parseInt(bits.substr(i, 8), 2).toString(16).padStart(2, '0');",
    "const counterHex = Math.floor(Date.now() / 30000).toString(16).padStart(16, '0');",
    "const hmac = hmacLib.HmacSHA1(hmacLib.enc.Hex.parse(counterHex), hmacLib.enc.Hex.parse(keyHex)).toString(hmacLib.enc.Hex);",
    "const offset = parseInt(hmac.slice(-1), 16);",
    "const code = (parseInt(hmac.substr(offset * 2, 8), 16) & 0x7fffffff) % 1000000;",
    "pm.collectionVariables.set('totp', String(code).padStart(6, '0'));",
]

def folder(name, items, desc=None, prerequest=None):
    f = {"name": name, "item": items}
    if prerequest:
        f["event"] = [{"listen": "prerequest", "script": {"type": "text/javascript", "exec": prerequest}}]
    if desc:
        f["description"] = desc
    return f

auth = folder("1. Auth", [
    req("Login admin", "POST", "/auth/login", {"email": "{{adminEmail}}", "password": "{{adminPassword}}"},
        tests=saving(200, [("adminToken", "body.accessToken")])),
    req("Login counter", "POST", "/auth/login", {"email": "{{counterEmail}}", "password": "{{counterPassword}}"},
        tests=saving(200, [("counterToken", "body.accessToken")])),
    req("Register customer", "POST", "/auth/register",
        {"email": "customer.{{$timestamp}}@test.com", "password": "Customer123", "fullName": "Postman Customer"},
        tests=saving(201, [("customerToken", "body.accessToken"), ("customerId", "body.user.id"), ("customerEmail", "body.user.email")])),
    req("Login with bad password (401)", "POST", "/auth/login", {"email": "{{adminEmail}}", "password": "Wrong123"},
        tests=status_test(401) + ["pm.test('uniform error body', () => pm.expect(pm.response.json()).to.have.keys('statusCode','error','message','path','timestamp'));"]),
    req("Register with weak password (400)", "POST", "/auth/register",
        {"email": "weak@test.com", "password": "weak", "fullName": "Weak"}, tests=status_test(400)),
    folder("2FA", [
        req("Generate 2FA secret", "POST", "/auth/2fa/generate", token="customerToken",
            tests=saving(201, [("twoFactorSecret", "body.secret")]),
            desc="Scan qrCodeDataUrl (paste it in the browser address bar) with Google Authenticator, or add the secret manually."),
        req("Enable 2FA", "POST", "/auth/2fa/enable", {"code": "{{totp}}"}, token="customerToken", tests=status_test(200)),
        req("Login (2FA step 1)", "POST", "/auth/login", {"email": "{{customerEmail}}", "password": "Customer123"},
            tests=saving(200, [("tempToken", "body.tempToken")])),
        req("Authenticate 2FA (step 2)", "POST", "/auth/2fa/authenticate", {"code": "{{totp}}"}, token="tempToken",
            tests=saving(200, [("customerToken", "body.accessToken")])),
        req("Disable 2FA", "POST", "/auth/2fa/disable", {"code": "{{totp}}"}, token="customerToken", tests=status_test(200)),
    ], prerequest=TOTP_SCRIPT, desc="The folder pre-request script computes {{totp}} from the stored secret, so the whole flow runs unattended. To use a real phone instead, scan qrCodeDataUrl and type the code."),
])

users = folder("2. Users", [
    req("My profile", "GET", "/users/me", token="customerToken", tests=status_test(200)),
    req("Update my profile", "PATCH", "/users/me", {"fullName": "Renamed Customer"}, token="customerToken", tests=status_test(200)),
    req("Change my password", "PATCH", "/users/me", {"currentPassword": "Customer123", "newPassword": "Customer456"}, token="customerToken"),
    req("Create counter staff (admin)", "POST", "/users",
        {"email": "door.{{$timestamp}}@cinereserva.com", "password": "Door12345", "fullName": "Door Staff", "roles": ["counter"]},
        token="adminToken", tests=saving(201, [("staffId", "body.id")])),
    req("List users (admin)", "GET", "/users", token="adminToken", query=[("limit", "10"), ("offset", "0")], tests=status_test(200)),
    req("List counters (admin)", "GET", "/users", token="adminToken", query=[("role", "counter")], tests=status_test(200)),
    req("Get user by id (admin)", "GET", "/users/{{customerId}}", token="adminToken", tests=status_test(200)),
    req("Assign roles (admin, RF2)", "PATCH", "/users/{{staffId}}/roles", {"roles": ["counter", "customer"]}, token="adminToken", tests=status_test(200)),
    req("Deactivate user (admin)", "PATCH", "/users/{{staffId}}/status", {"isActive": False}, token="adminToken", tests=status_test(200)),
    req("List users as customer (403)", "GET", "/users", token="customerToken", tests=status_test(403)),
    req("Profile without token (401)", "GET", "/users/me", tests=status_test(401)),
])

roles = folder("3. Roles (admin)", [
    req("List roles", "GET", "/roles", token="adminToken", tests=status_test(200)),
    req("Create role", "POST", "/roles", {"name": "auditor-{{$timestamp}}"}, token="adminToken", tests=saving(201, [("roleId", "body.id")])),
    req("Get role", "GET", "/roles/{{roleId}}", token="adminToken", tests=status_test(200)),
    req("Rename role", "PATCH", "/roles/{{roleId}}", {"name": "auditor-renamed-{{$timestamp}}"}, token="adminToken", tests=status_test(200)),
    req("Delete role", "DELETE", "/roles/{{roleId}}", token="adminToken", tests=status_test(204)),
])

movies = folder("4. Movies", [
    req("List movies (public)", "GET", "/movies", query=[("limit", "10"), ("genre", "Sci-Fi")], tests=status_test(200)),
    req("Create movie (admin)", "POST", "/movies",
        {"title": "Postman Movie {{$timestamp}}", "synopsis": "Created from Postman", "durationMinutes": 120, "genre": "Drama", "rating": "+12"},
        token="adminToken", tests=saving(201, [("movieId", "body.id")])),
    req("Get movie", "GET", "/movies/{{movieId}}", tests=status_test(200)),
    req("Update movie (admin)", "PATCH", "/movies/{{movieId}}", {"durationMinutes": 125}, token="adminToken", tests=status_test(200)),
    req("Create movie as customer (403)", "POST", "/movies",
        {"title": "Nope", "synopsis": "x", "durationMinutes": 90, "genre": "Drama"}, token="customerToken", tests=status_test(403)),
])

rooms = folder("5. Rooms", [
    req("List rooms (public)", "GET", "/rooms", tests=status_test(200)),
    req("Create room (admin)", "POST", "/rooms",
        {"name": "Sala Postman {{$timestamp}}", "rows": 5, "columns": 8, "specialSeats": [{"row": 5, "column": 4, "type": "VIP"}]},
        token="adminToken", tests=saving(201, [("roomId", "body.id")])),
    req("Get room", "GET", "/rooms/{{roomId}}", tests=status_test(200)),
])

showtimes = folder("6. Showtimes", [
    req("Create showtime (admin)", "POST", "/showtimes",
        {"movieId": "{{movieId}}", "roomId": "{{roomId}}", "startTime": "2026-12-20T20:00:00-05:00", "price": 18000},
        token="adminToken", tests=saving(201, [("showtimeId", "body.id")])),
    req("Billboard with filters (public)", "GET", "/showtimes", query=[("movieId", "{{movieId}}")], tests=status_test(200)),
    req("Showtime detail and seat map", "GET", "/showtimes/{{showtimeId}}",
        tests=status_test(200) + [
            "const seats = pm.response.json().room.seats;",
            "if (seats && seats.length) {",
            "  pm.collectionVariables.set('seatId', seats[0].id);",
            "  if (seats.length > 1) pm.collectionVariables.set('secondSeatId', seats[1].id);",
            "  const vip = seats.find(s => s.type === 'VIP');",
            "  if (vip) pm.collectionVariables.set('vipSeatId', vip.id);",
            "}",
        ]),
])

booking = folder("7. Booking and check-in", [
    req("Hold seats (customer)", "POST", "/seat-holds", {"showtimeId": "{{showtimeId}}", "seatIds": ["{{seatId}}"]},
        token="customerToken", tests=saving(201, [("seatHoldId", "body[0].id")])),
    req("Hold same seat again (409)", "POST", "/seat-holds", {"showtimeId": "{{showtimeId}}", "seatIds": ["{{seatId}}"]},
        token="customerToken", tests=status_test(409)),
    req("Confirm reservation (customer, RF03/RF08)", "POST", "/reservations/confirm", {"showtimeId": "{{showtimeId}}", "seatHoldIds": ["{{seatHoldId}}"]},
        token="customerToken", tests=saving(201, [("reservationId", "body.id")]) + [
            "pm.test('reservation confirmed', () => pm.expect(pm.response.json().status).to.eql('CONFIRMED'));",
        ]),
    req("Get my reservation", "GET", "/reservations/{{reservationId}}", token="customerToken", tests=status_test(200)),
    req("My reservations history (customer, RF10/RF12)", "GET", "/reservations/me", token="customerToken",
        tests=status_test(200) + [
            "pm.test('has summary and collections', () => {",
            "  const b = pm.response.json();",
            "  pm.expect(b).to.have.property('summary');",
            "  pm.expect(b).to.have.property('upcoming');",
            "  pm.expect(b).to.have.property('past');",
            "});",
        ]),
    req("My reservations upcoming filter", "GET", "/reservations/me", token="customerToken", query=[("timeframe", "upcoming")],
        tests=status_test(200) + ["pm.test('is array', () => pm.expect(Array.isArray(pm.response.json())).to.be.true);"]),
    req("My reservations past filter", "GET", "/reservations/me", token="customerToken", query=[("timeframe", "past")],
        tests=status_test(200) + ["pm.test('is array', () => pm.expect(Array.isArray(pm.response.json())).to.be.true);"]),
    req("My tickets list (customer, RF10)", "GET", "/tickets/my-tickets", token="customerToken",
        tests=status_test(200) + ["pm.test('is array', () => pm.expect(Array.isArray(pm.response.json())).to.be.true);"]),
    req("Tickets of the reservation", "GET", "/tickets/reservation/{{reservationId}}", token="customerToken",
        tests=saving(200, [("ticketCode", "body[0].code")]) + [
            "pm.test('ticket has unit price', () => pm.expect(pm.response.json()[0]).to.have.property('price'));",
        ]),
    req("Validate ticket at the door (counter)", "POST", "/tickets/validate/{{ticketCode}}", {"showtimeId": "{{showtimeId}}"},
        token="counterToken", tests=status_test(200)),
    req("Validate same ticket again (409)", "POST", "/tickets/validate/{{ticketCode}}", {},
        token="counterToken", tests=status_test(409)),
    req("Validate as customer (403)", "POST", "/tickets/validate/{{ticketCode}}", {}, token="customerToken", tests=status_test(403)),
    req("Cancel reservation with used ticket (400, RF13)", "PATCH", "/reservations/{{reservationId}}/cancel", {},
        token="customerToken", tests=status_test(400)),
    folder("Cancellation and seat release flow (RF13)", [
        req("Hold second seat", "POST", "/seat-holds", {"showtimeId": "{{showtimeId}}", "seatIds": ["{{secondSeatId}}"]},
            token="customerToken", tests=saving(201, [("secondSeatHoldId", "body[0].id")])),
        req("Confirm second reservation", "POST", "/reservations/confirm", {"showtimeId": "{{showtimeId}}", "seatHoldIds": ["{{secondSeatHoldId}}"]},
            token="customerToken", tests=saving(201, [("cancellableReservationId", "body.id")])),
        req("Cancel reservation as counter staff (403)", "PATCH", "/reservations/{{cancellableReservationId}}/cancel", {},
            token="counterToken", tests=status_test(403)),
        req("Cancel reservation as owner customer (200)", "PATCH", "/reservations/{{cancellableReservationId}}/cancel", {},
            token="customerToken", tests=status_test(200) + [
                "pm.test('reservation is CANCELLED', () => pm.expect(pm.response.json().status).to.eql('CANCELLED'));",
            ]),
        req("Cancel already cancelled reservation (400)", "PATCH", "/reservations/{{cancellableReservationId}}/cancel", {},
            token="customerToken", tests=status_test(400)),
        req("Seat is freed after cancellation (can hold again)", "POST", "/seat-holds", {"showtimeId": "{{showtimeId}}", "seatIds": ["{{secondSeatId}}"]},
            token="customerToken", tests=status_test(201)),
    ]),
    req("All reservations (admin)", "GET", "/reservations", token="adminToken", tests=status_test(200)),
])

reports = folder("8. Reports (admin, RF12/RF15)", [
    req("Consolidated summary report (admin)", "GET", "/reports/summary", token="adminToken",
        tests=status_test(200) + [
            "pm.test('has summary metrics', () => {",
            "  const b = pm.response.json();",
            "  pm.expect(b).to.have.property('totalShowtimes');",
            "  pm.expect(b).to.have.property('totalRevenue');",
            "  pm.expect(b).to.have.property('breakdownBySeatType');",
            "  pm.expect(b).to.have.property('movies');",
            "});",
        ]),
    req("Summary report filtered by movie (admin)", "GET", "/reports/summary", token="adminToken",
        query=[("movieId", "{{movieId}}")], tests=status_test(200)),
    req("Summary report filtered by room (admin)", "GET", "/reports/summary", token="adminToken",
        query=[("roomId", "{{roomId}}")], tests=status_test(200)),
    req("Showtime report with seat type breakdown (admin)", "GET", "/reports/showtimes/{{showtimeId}}", token="adminToken",
        tests=status_test(200) + [
            "pm.test('has showtime metrics and breakdown', () => {",
            "  const b = pm.response.json();",
            "  pm.expect(b).to.have.property('totalCapacity');",
            "  pm.expect(b).to.have.property('ticketsSold');",
            "  pm.expect(b).to.have.property('occupancyPercentage');",
            "  pm.expect(b).to.have.property('breakdownBySeatType');",
            "  pm.expect(b.breakdownBySeatType).to.have.property('normal');",
            "  pm.expect(b.breakdownBySeatType).to.have.property('vip');",
            "});",
        ]),
    req("Summary report as customer (403)", "GET", "/reports/summary", token="customerToken", tests=status_test(403)),
    req("Showtime report as customer (403)", "GET", "/reports/showtimes/{{showtimeId}}", token="customerToken", tests=status_test(403)),
    req("Showtime report invalid UUID (400)", "GET", "/reports/showtimes/not-a-valid-uuid", token="adminToken", tests=status_test(400)),
])

health = folder("0. Health", [req("Health check", "GET", "/health", tests=status_test(200))])

variables = {
    "baseUrl": "http://localhost:3000/api",
    "adminEmail": "admin@cinereserva.com", "adminPassword": "Admin123",
    "counterEmail": "counter@cinereserva.com", "counterPassword": "Counter123",
    "adminToken": "", "counterToken": "", "customerToken": "", "tempToken": "",
    "customerId": "", "customerEmail": "", "staffId": "", "roleId": "", "twoFactorSecret": "", "totp": "",
    "movieId": "", "roomId": "", "showtimeId": "", "seatId": "", "secondSeatId": "", "vipSeatId": "",
    "seatHoldId": "", "secondSeatHoldId": "", "reservationId": "", "cancellableReservationId": "", "ticketCode": "",
}

collection = {
    "info": {
        "_postman_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "cinereserva-api")),
        "name": "CineReserva API",
        "description": "Run the folders in order (Collection Runner works too). Tokens and ids are stored in collection variables by the test scripts. Requires the seed: `pnpm seed` locally or `docker compose exec api node dist/seed/seed.js`.",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "item": [health, auth, users, roles, movies, rooms, showtimes, booking, reports],
    "variable": [{"key": k, "value": v, "type": "string"} for k, v in variables.items()],
}

with open(f"{out_dir}/CineReserva.postman_collection.json", "w") as f:
    json.dump(collection, f, indent=2, ensure_ascii=False)
    f.write("\n")

def env(name, base):
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name)), "name": name,
            "values": [{"key": "baseUrl", "value": base, "type": "default", "enabled": True}],
            "_postman_variable_scope": "environment"}


