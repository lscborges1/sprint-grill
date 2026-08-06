import { createLogger } from "@sprint-griller/core";

/** Logger da fronteira web. As demais fronteiras criam o seu próprio `name`. */
export const logger = createLogger({ name: "web" });
