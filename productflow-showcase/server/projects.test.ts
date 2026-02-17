import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as dbHelpers from "./db-helpers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId: number = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `test${userId}@example.com`,
    name: `Test User ${userId}`,
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return ctx;
}

describe("projects router", () => {
  it("should create a new project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const project = await caller.projects.create({
      title: "Test Project",
      rawRequirement: "This is a test requirement",
    });

    expect(project).toBeDefined();
    expect(project.title).toBe("Test Project");
    expect(project.rawRequirement).toBe("This is a test requirement");
    expect(project.userId).toBe(ctx.user.id);
    expect(project.status).toBe("draft");
    expect(project.currentStep).toBe(0);

    // Clean up
    await dbHelpers.deleteProject(project.id, ctx.user.id);
  });

  it("should list user's projects", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a test project
    const project = await caller.projects.create({
      title: "Test Project for List",
      rawRequirement: "Test requirement",
    });

    // List projects
    const projects = await caller.projects.list();

    expect(projects).toBeDefined();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some(p => p.id === project.id)).toBe(true);

    // Clean up
    await dbHelpers.deleteProject(project.id, ctx.user.id);
  });

  it("should get a specific project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a test project
    const created = await caller.projects.create({
      title: "Test Project for Get",
      rawRequirement: "Test requirement",
    });

    // Get the project
    const project = await caller.projects.get({ projectId: created.id });

    expect(project).toBeDefined();
    expect(project?.id).toBe(created.id);
    expect(project?.title).toBe("Test Project for Get");

    // Clean up
    await dbHelpers.deleteProject(created.id, ctx.user.id);
  });

  it("should delete a project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a test project
    const project = await caller.projects.create({
      title: "Test Project for Delete",
      rawRequirement: "Test requirement",
    });

    // Delete the project
    const result = await caller.projects.delete({ projectId: project.id });

    expect(result.success).toBe(true);

    // Verify it's deleted
    const deleted = await caller.projects.get({ projectId: project.id });
    expect(deleted).toBeNull();
  });

  it("should not allow accessing another user's project", async () => {
    const ctx1 = createAuthContext(1);
    const ctx2 = createAuthContext(2);
    const caller1 = appRouter.createCaller(ctx1);
    const caller2 = appRouter.createCaller(ctx2);

    // User 1 creates a project
    const project = await caller1.projects.create({
      title: "User 1 Project",
      rawRequirement: "User 1 requirement",
    });

    // User 2 tries to access it
    const accessed = await caller2.projects.get({ projectId: project.id });

    expect(accessed).toBeNull();

    // Clean up
    await dbHelpers.deleteProject(project.id, ctx1.user.id);
  });
});
