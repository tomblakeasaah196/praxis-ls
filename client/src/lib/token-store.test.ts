import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenStore } from "./token-store";

/**
 * The refresh token is the one value every tab of the workspace listens to.
 * A `storage` event for it with no value tells every other tab "the session
 * ended" and makes it lock (auth-context). So rotating the token must never
 * pass through "no value": a refresh in one tab used to remove the key and
 * then set it, every other tab locked on the removal, and two open tabs
 * knocked each other between the lock screen and the app without end.
 */
describe("the shared refresh token", () => {
  const KEY = tokenStore.REFRESH_KEY;
  let removed: string[];
  let written: Array<[string, string]>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    removed = [];
    written = [];
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, k: string) {
      if (this === localStorage) removed.push(k);
      delete (this as unknown as Record<string, string>)[k];
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (this === localStorage) written.push([k, v]);
      (this as unknown as Record<string, string>)[k] = String(v);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is written over when it rotates, never removed first", () => {
    tokenStore.setRefresh("first");
    removed.length = 0;
    written.length = 0;

    tokenStore.setRefresh("rotated");

    expect(removed).not.toContain(KEY);
    expect(written).toEqual([[KEY, "rotated"]]);
  });

  it("is removed only when the session really ends", () => {
    tokenStore.setRefresh("first");
    removed.length = 0;
    tokenStore.setRefresh(null);
    expect(removed).toContain(KEY);
  });

  it("still clears the token an older build left in this tab's own storage", () => {
    tokenStore.setRefresh("rotated");
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(KEY);
  });
});
