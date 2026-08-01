import assert from "node:assert/strict";
import test from "node:test";
import {
  appSurface,
  enforceSurfaceBoundary,
  isClinicRequest,
  isStaffRequest,
} from "../lib/surface.ts";

const request = (path: string, method = "GET") =>
  new Request(`https://example.test${path}`, { method });

test("unknown deployment profiles fail closed to the patient surface", () => {
  assert.equal(appSurface(undefined), "patient");
  assert.equal(appSurface("typo"), "patient");
  assert.equal(appSurface("combined"), "combined");
  assert.equal(appSurface("patient"), "patient");
  assert.equal(appSurface("clinic"), "clinic");
});

test("staff routes include every patient-data endpoint used by Clinic OS", () => {
  assert.equal(isStaffRequest("GET", "/command-center"), true);
  assert.equal(isStaffRequest("GET", "/api/bookings"), true);
  assert.equal(isStaffRequest("POST", "/api/bookings"), false);
  assert.equal(isStaffRequest("PATCH", "/api/bookings/booking-1"), true);
  assert.equal(isStaffRequest("GET", "/api/bookings/booking-1/history"), true);
  assert.equal(isStaffRequest("POST", "/api/clinic/appointments"), true);
  assert.equal(isStaffRequest("GET", "/api/clinic/notifications"), true);
  assert.equal(isStaffRequest("POST", "/api/clinic/notifications"), true);
});

test("the authentication surfaces are staff-only on the public deployment", () => {
  // These carry an enrolment secret, the staff directory, and a bulk export of
  // the whole register. All three are staff endpoints by prefix, which is what
  // keeps them off the public origin — asserted explicitly, because a future
  // endpoint added outside `/api/clinic/` would be published silently.
  for (const path of [
    "/command-center/security",
    "/command-center/verify",
    "/api/clinic/mfa",
    "/api/clinic/staff",
    "/api/clinic/export",
    "/login",
    "/api/staff/login",
    "/api/staff/password",
  ]) {
    assert.equal(isStaffRequest("GET", path), true, path);
    assert.equal(isStaffRequest("POST", path), true, path);
    // And each is reachable on the deployment that is supposed to serve it.
    assert.equal(isClinicRequest("GET", path), true, path);
  }
});

test("the public deployment hides that the authentication APIs exist at all", async () => {
  for (const path of [
    "/api/clinic/mfa",
    "/api/clinic/staff",
    "/api/clinic/export",
    "/api/staff/login",
  ]) {
    const blocked = enforceSurfaceBoundary(request(path), { surface: "patient" });
    assert.equal(blocked?.status, 404, path);
    assert.equal(await blocked?.text(), "Not found", path);
  }
});

test("the public deployment cannot serve the dashboard or staff APIs", async () => {
  const dashboard = enforceSurfaceBoundary(request("/command-center"), {
    surface: "patient",
    clinicDashboardUrl: "https://clinic.example.test",
  });
  assert.equal(dashboard?.status, 307);
  assert.equal(dashboard?.headers.get("location"), "https://clinic.example.test/");

  const privateApi = enforceSurfaceBoundary(request("/api/bookings"), {
    surface: "patient",
  });
  assert.equal(privateApi?.status, 404);
  assert.equal(await privateApi?.text(), "Not found");

  assert.equal(
    enforceSurfaceBoundary(request("/api/bookings", "POST"), { surface: "patient" }),
    null,
  );
});

test("the clinic deployment exposes only staff operations and shared availability", () => {
  assert.equal(isClinicRequest("GET", "/api/availability"), true);
  assert.equal(isClinicRequest("POST", "/api/availability"), false);
  assert.equal(isClinicRequest("GET", "/api/clinic/audit"), true);
  assert.equal(isClinicRequest("POST", "/api/clinic/notifications"), true);

  const root = enforceSurfaceBoundary(request("/"), { surface: "clinic" });
  assert.equal(root?.headers.get("location"), "https://example.test/command-center");

  assert.equal(
    enforceSurfaceBoundary(request("/command-center"), { surface: "clinic" }),
    null,
  );
  assert.equal(
    enforceSurfaceBoundary(request("/api/clinic/appointments", "POST"), {
      surface: "clinic",
    }),
    null,
  );

  const marketing = enforceSurfaceBoundary(request("/treatments/rhinoplasty"), {
    surface: "clinic",
    publicSiteUrl: "https://www.example.test",
  });
  assert.equal(marketing?.status, 307);
  assert.equal(
    marketing?.headers.get("location"),
    "https://www.example.test/treatments/rhinoplasty",
  );
});
