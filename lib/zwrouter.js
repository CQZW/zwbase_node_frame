
const   express         = require('express');

class ZWRouter
{
    constructor(  )
    {
        this._routermap =   [];
        this._router = express.Router();
        this._router.all('/*', (req,res,next) => {this.routerMap(req,res,next)} );
    }
    getRouter()
    {
        return this._router;
    }

    regCtr( routername ,ctrobj )
    {
        //更多规则 http://www.expressjs.com.cn/guide/routing.html,,这里使用最简单的..
        // regCtr('/user',UserCtr),将所有/user路径的请求使用UserCtr来处理,
        //比如,/user.getinfo?userid=xxx 
        this._routermap[ routername ] = ctrobj;
    }
    routerMap( req , res , next )
    {
        let reqpath = req.path;
        let ctrobj  = null;
        do
        {//根据路由寻找控制器对象
            //1.寻找全路径的匹配
            ctrobj = this._routermap[ reqpath ];
            if( ctrobj ) break;

            //匹配前缀
            let tarr = reqpath.split('.');
            if( tarr && tarr.length == 2 )
            {
                tarr = tarr[0];
                ctrobj = this._routermap[ tarr ];
                if( ctrobj ) break;
                tarr = tarr.relpace('/','');
                ctrobj = this._routermap[ tarr ];
                if( ctrobj ) break;
            }
        }while(0);

        if( ctrobj )
            ctrobj.doRouter(req , res , next );
        else 
            next();
    }
}

module.exports = ZWRouter;