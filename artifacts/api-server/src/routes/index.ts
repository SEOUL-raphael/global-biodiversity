import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gbifRouter from "./gbif";
import kgRouter from "./kg";
import cogneeRouter from "./cognee";
import aiRouter from "./ai";
import enrichRouter from "./enrich";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gbifRouter);
router.use(kgRouter);
router.use(cogneeRouter);
router.use(aiRouter);
router.use(enrichRouter);
router.use(adminRouter);

export default router;
