import { test } from "node:test";
import assert from "node:assert/strict";
import { LookupError, SsrfError, expandIpv6, hostnameAllowed, isPublicIp, parseTarget, pinnedLookup, unmapIpv4, vetTarget } from "./ssrf.ts";
import type { LookupFn } from "./ssrf.ts";

// ---- isPublicIp table ----------------------------------------------------------

const BLOCKED_V4 = [
  "0.0.0.0", "0.1.2.3", "10.0.0.5", "10.255.255.255", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.1.2.3",
  "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.88.99.1",
  "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.255",
  "240.0.0.1", "255.255.255.255",
];
const PUBLIC_V4 = ["8.8.8.8", "1.1.1.1", "9.9.9.9", "172.32.0.1", "172.15.255.255", "100.128.0.1", "100.63.255.255", "192.0.1.1", "192.0.3.1", "198.17.255.255", "198.20.0.1", "51.38.10.20", "223.255.255.255"];
const BLOCKED_V6 = [
  "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::FFFF:127.0.0.1", "::ffff:10.0.0.5", "::ffff:169.254.169.254", "::ffff:192.168.0.1",
  "::127.0.0.1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::8.8.8.8", "100::1", "2001:db8::1", "2001:db8:ffff::1", "fc00::1", "fd12:3456::1",
  "fdff:ffff::1", "fe80::1", "fe80::1%eth0", "febf::1", "ff02::1", "ff00::", "[::1]",
];
const PUBLIC_V6 = ["2a00:1450:4007:80c::200e", "2606:4700::6810:84e5", "::ffff:8.8.8.8", "::ffff:808:808", "2001:4860:4860::8888", "fec0::1"];

test("isPublicIp: blocked IPv4 ranges", () => {
  for (const ip of BLOCKED_V4) assert.equal(isPublicIp(ip), false, `${ip} must be blocked`);
});

test("isPublicIp: public IPv4 addresses and range edges", () => {
  for (const ip of PUBLIC_V4) assert.equal(isPublicIp(ip), true, `${ip} must be public`);
});

test("isPublicIp: blocked IPv6 incl. mapped / compatible / NAT64 forms", () => {
  for (const ip of BLOCKED_V6) {
    const bare = ip.replace(/^\[|\]$/g, "");
    assert.equal(isPublicIp(bare), false, `${ip} must be blocked`);
  }
});

test("isPublicIp: public IPv6 and mapped public IPv4", () => {
  for (const ip of PUBLIC_V6) assert.equal(isPublicIp(ip), true, `${ip} must be public`);
});

test("isPublicIp: garbage is never public", () => {
  for (const s of ["", "not an ip", "127.0.0.1 ", "8.8.8", "8.8.8.8.8", "999.1.1.1", "0x7f.1", "2130706433", "[::1]", "::g", "1:2:3:4:5:6:7:8:9"]) {
    assert.equal(isPublicIp(s), false, `${JSON.stringify(s)} must not be public`);
  }
});

test("expandIpv6 / unmapIpv4", () => {
  assert.deepEqual(expandIpv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(expandIpv6("::ffff:127.0.0.1"), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  assert.deepEqual(expandIpv6("2001:db8::8:800:200c:417a"), [0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a]);
  assert.equal(expandIpv6("1::2::3"), null);
  assert.equal(expandIpv6("1:2:3"), null);
  assert.equal(unmapIpv4("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(unmapIpv4("::ffff:7f00:1"), "127.0.0.1");
  assert.equal(unmapIpv4("::ffff:8.8.8.8"), "8.8.8.8");
  assert.equal(unmapIpv4("::127.0.0.1"), "127.0.0.1");
  assert.equal(unmapIpv4("::1"), null);
  assert.equal(unmapIpv4("::"), null);
  assert.equal(unmapIpv4("2a00::1"), null);
  assert.equal(unmapIpv4("64:ff9b::7f00:1"), null);
});

// ---- hostnames and static URL rules -------------------------------------------------

test("hostnameAllowed: local and internal names refused", () => {
  for (const h of ["localhost", "LOCALHOST", "foo.localhost", "printer.local", "db.internal", "metadata.google.internal", "nas.home.arpa", "x.y.home.arpa", "localhost.", ""]) {
    assert.equal(hostnameAllowed(h), false, `${h} must be refused`);
  }
  for (const h of ["example.fr", "digitalm.eu", "localhost.example.com", "mylocal.fr", "internal-tools.example.com", "home.arpa.example.com"]) {
    assert.equal(hostnameAllowed(h), true, `${h} must be allowed`);
  }
});

function refuses(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof SsrfError && e.code === code && e.message.startsWith("ssrf:"), `expected ${code}`);
}

test("parseTarget: scheme, credentials, port, host rules", () => {
  refuses(() => parseTarget("ftp://example.fr/"), "ssrf:scheme");
  refuses(() => parseTarget("javascript:alert(1)"), "ssrf:scheme");
  refuses(() => parseTarget("file:///etc/passwd"), "ssrf:scheme");
  refuses(() => parseTarget("gopher://example.fr/"), "ssrf:scheme");
  refuses(() => parseTarget("https://user:pw@example.fr/"), "ssrf:credentials");
  refuses(() => parseTarget("https://user@example.fr/"), "ssrf:credentials");
  refuses(() => parseTarget("http://127.0.0.1:3002/"), "ssrf:port");
  refuses(() => parseTarget("http://example.fr:8080/"), "ssrf:port");
  refuses(() => parseTarget("https://example.fr:8443/"), "ssrf:port");
  refuses(() => parseTarget("http://localhost/"), "ssrf:host");
  refuses(() => parseTarget("http://metadata.google.internal/computeMetadata/v1/"), "ssrf:host");
  refuses(() => parseTarget("http://foo.localhost/"), "ssrf:host");
  refuses(() => parseTarget("http://nas.local/"), "ssrf:host");
  refuses(() => parseTarget("http://router.home.arpa/"), "ssrf:host");
  refuses(() => parseTarget(""), "ssrf:url");
  refuses(() => parseTarget("not a url"), "ssrf:url");
  refuses(() => parseTarget(`https://example.fr/${"a".repeat(2100)}`), "ssrf:url");

  const a = parseTarget("http://Example.FR./contact?x=1");
  assert.equal(a.hostname, "example.fr");
  assert.equal(a.port, 80);
  assert.equal(a.https, false);
  assert.equal(a.ipLiteral, null);
  const b = parseTarget("https://example.fr:443/");
  assert.equal(b.port, 443);
  assert.equal(b.https, true);
  const c = parseTarget("http://example.fr:80/");
  assert.equal(c.port, 80);
  const d = parseTarget("http://[2a00:1450:4007:80c::200e]/");
  assert.equal(d.ipLiteral, "2a00:1450:4007:80c::200e");
  const e = parseTarget("http://8.8.8.8/");
  assert.equal(e.ipLiteral, "8.8.8.8");
});

// ---- vetTarget with an injected lookup -------------------------------------------------

const lookupOf =
  (answers: Record<string, { address: string; family: number }[] | Error>): LookupFn =>
  async (hostname) => {
    const a = answers[hostname];
    if (!a) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    if (a instanceof Error) throw a;
    return a;
  };

async function rejectsSsrf(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof SsrfError && e.code === code && e.message.startsWith("ssrf:"), `expected ${code}`);
}

test("vetTarget: IP literals in every form are refused without DNS", async () => {
  const lookup: LookupFn = async () => {
    throw new Error("lookup must not be called for literals");
  };
  await rejectsSsrf(vetTarget("http://127.0.0.1/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://169.254.169.254/latest/meta-data/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://[::1]/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://[::ffff:127.0.0.1]/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://[::ffff:7f00:1]/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://[fe80::1]/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://10.0.0.5/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://192.168.1.1/", { lookup }), "ssrf:private_ip");
  // The WHATWG parser normalises decimal / hex / short forms to dotted quads.
  await rejectsSsrf(vetTarget("http://2130706433/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://0x7f.0.0.1/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://0x7f000001/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://127.1/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://0177.0.0.1/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://0/", { lookup }), "ssrf:private_ip");
  // Port before address: 127.0.0.1:3002 never reaches the IP check.
  await rejectsSsrf(vetTarget("http://127.0.0.1:3002/", { lookup }), "ssrf:port");
});

test("vetTarget: public IP literals pass; IPv6-only literal is a lookup failure, not a refusal", async () => {
  const lookup: LookupFn = async () => {
    throw new Error("lookup must not be called for literals");
  };
  const t = await vetTarget("http://8.8.8.8/x", { lookup });
  assert.equal(t.ip, "8.8.8.8");
  const m = await vetTarget("http://[::ffff:8.8.8.8]/", { lookup });
  assert.equal(m.ip, "8.8.8.8");
  await assert.rejects(vetTarget("http://[2a00:1450:4007:80c::200e]/", { lookup }), (e: unknown) => e instanceof LookupError && e.code === "no_ipv4");
});

test("vetTarget: any private answer refuses the whole host (first public, second 127.0.0.1)", async () => {
  const lookup = lookupOf({
    "rebind.example": [
      { address: "51.38.10.20", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    "private.example": [{ address: "10.0.0.5", family: 4 }],
    "v6private.example": [
      { address: "51.38.10.20", family: 4 },
      { address: "::ffff:10.0.0.5", family: 6 },
    ],
    "meta.example": [{ address: "169.254.169.254", family: 4 }],
  });
  await rejectsSsrf(vetTarget("https://rebind.example/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("https://private.example/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("https://v6private.example/", { lookup }), "ssrf:private_ip");
  await rejectsSsrf(vetTarget("http://meta.example/", { lookup }), "ssrf:private_ip");
});

test("vetTarget: an allowed host pins the first public IPv4; DNS failures are LookupErrors", async () => {
  const lookup = lookupOf({
    "digitalm.eu": [
      { address: "2001:41d0:1::1", family: 6 },
      { address: "51.38.10.20", family: 4 },
      { address: "51.38.10.21", family: 4 },
    ],
    "v6only.example": [{ address: "2001:41d0:1::1", family: 6 }],
    "empty.example": [],
    "servfail.example": Object.assign(new Error("queryA ESERVFAIL"), { code: "ESERVFAIL" }),
  });
  const t = await vetTarget("https://digitalm.eu/", { lookup });
  assert.equal(t.ip, "51.38.10.20");
  assert.deepEqual(t.addresses, ["2001:41d0:1::1", "51.38.10.20", "51.38.10.21"]);
  assert.equal(t.hostname, "digitalm.eu");
  assert.equal(t.https, true);
  assert.equal(t.port, 443);
  await assert.rejects(vetTarget("https://v6only.example/", { lookup }), (e: unknown) => e instanceof LookupError && e.code === "no_ipv4");
  await assert.rejects(vetTarget("https://empty.example/", { lookup }), (e: unknown) => e instanceof LookupError && e.code === "dns");
  await assert.rejects(vetTarget("https://nope.example/", { lookup }), (e: unknown) => e instanceof LookupError && e.code === "dns" && e.message.includes("ENOTFOUND"));
  await assert.rejects(vetTarget("https://servfail.example/", { lookup }), (e: unknown) => e instanceof LookupError && e.code === "dns" && !e.message.startsWith("ssrf:"));
});

test("vetTarget: static refusals happen before any DNS call", async () => {
  let calls = 0;
  const lookup: LookupFn = async () => {
    calls++;
    return [{ address: "8.8.8.8", family: 4 }];
  };
  await rejectsSsrf(vetTarget("http://localhost/", { lookup }), "ssrf:host");
  await rejectsSsrf(vetTarget("http://example.fr:3002/", { lookup }), "ssrf:port");
  await rejectsSsrf(vetTarget("ftp://example.fr/", { lookup }), "ssrf:scheme");
  assert.equal(calls, 0);
});

test("pinnedLookup answers with the vetted IP in both callback shapes", () => {
  const lookup = pinnedLookup("51.38.10.20");
  lookup("digitalm.eu", { all: false }, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, "51.38.10.20");
    assert.equal(family, 4);
  });
  lookup("digitalm.eu", { all: true }, (err, address) => {
    assert.equal(err, null);
    assert.deepEqual(address, [{ address: "51.38.10.20", family: 4 }]);
  });
  lookup("digitalm.eu", undefined, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, "51.38.10.20");
    assert.equal(family, 4);
  });
});
