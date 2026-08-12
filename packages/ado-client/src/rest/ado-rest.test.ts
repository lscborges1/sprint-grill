import { expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { RequestSpec } from "./ado-rest";

const _schema = z.object({ id: z.number() });
type Spec = RequestSpec<typeof _schema>;

it("should require write auditing for mutating HTTP methods", () => {
  expectTypeOf<{
    operation: string;
    path: string;
    schema: typeof _schema;
    method: "PATCH";
  }>().not.toMatchTypeOf<Spec>();
  expectTypeOf<{
    operation: string;
    path: string;
    schema: typeof _schema;
    method: "PATCH";
    write: true;
  }>().toMatchTypeOf<Spec>();
});

it("should keep POST available for read APIs with request bodies", () => {
  expectTypeOf<{
    operation: string;
    path: string;
    schema: typeof _schema;
    method: "POST";
    body: { query: string };
  }>().toMatchTypeOf<Spec>();
});
