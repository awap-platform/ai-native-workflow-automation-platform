import { switchTenant } from "../tenantSwitch";

describe("tenant switch", () => {
  it("clears every cached resource before changing the tenant cookie (U8-08)", () => {
    document.cookie = "awap_tenant=tenant-a; path=/";
    const order: string[] = [];
    const queryClient = {
      clear: jest.fn(() => {
        order.push("clear");
        expect(document.cookie).toContain("awap_tenant=tenant-a");
      }),
    };

    switchTenant(queryClient, "tenant-b");

    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["clear"]);
    expect(document.cookie).toContain("awap_tenant=tenant-b");
  });
});
