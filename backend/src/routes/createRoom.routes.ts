import { Router, Request, Response, NextFunction } from "express";

// Source - https://stackoverflow.com/a/1349426
// Posted by csharptest.net, modified by community. See post 'Timeline' for change history
// Retrieved 2026-10-12, License - CC BY-SA 4.0

function makeid(length: number) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  // TODO: check for overlaps before creating code
  res.send(makeid(6));
});

export default router;
