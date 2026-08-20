import { defineConfig } from "orval";
import path from "path";

const root = "/home/runner/workspace";
const apiClientReactSrc = path.join(root, "lib", "api-client-react", "src");
const apiZodSrc = path.join(root, "lib", "api-zod", "src");
const openapiYaml = path.join(root, "lib", "api-spec", "openapi.yaml");

export default defineConfig({
  "api-client-react": {
    input: {
      target: openapiYaml,
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.join(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: openapiYaml,
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
