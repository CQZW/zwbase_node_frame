
const   express         = require('express');
class ZWRouter
{
    /**
     *Creates an instance of ZWRouter.
     * @param {} pathprefix  路由前缀
     * 
     * 将对应路由前缀请求 路由到  ZWRouter,
     * 
     * ZWRouter在根据配置的控制器进行分发到控制器
     * @memberof ZWRouter
     */
    constructor( pathprefix )
    {
        this._pathprefix = pathprefix;
        this._routermap =   [];
        this._router = express.Router();
        this._router.all('/*', (req,res,next) => {this.routerMap(req,res,next)} );
    }
    /**
     * 获取express的路由对象
     *
     * @returns 
     * @memberof ZWRouter
     */
    getRouter()
    {
        return this._router;
    }

    /**
     * 获取路径前缀
     *
     * @returns
     * @memberof ZWRouter
     */
    getPathPrefix()
    {
        return this._pathprefix;
    }
    /**
     * 注册请求路径前缀 响应的控制器
     * 
     * 比如 regCtr('/user',UserCtr),将所有/user路径的请求使用UserCtr来处理,
     * @param {*} routername
     * @param {ZWBaseCtr|ZWRouter} ctrobj
     * @memberof ZWRouter
     */
    regCtr( routername ,ctrobj )
    {
        //更多规则 http://www.expressjs.com.cn/guide/routing.html,,这里使用最简单的..
        // regCtr('/user',UserCtr),将所有/user路径的请求使用UserCtr来处理,
        //比如  /user.getinfo?userid=xxx 
        //     /user/getinfo?userid=xxx 
        if( ctrobj instanceof ZWRouter )
            this._routermap[ routername ] = ctrobj;
        else 
            this._routermap[ routername ] = ctrobj;
    }
     /**
     * 内部方法,处理路由映射到控制器
     *
     * @param {*} req
     * @param {*} res
     * @param {*} next
     * @memberof ZWRouter
     */
    routerMap(req , res , next )
    {
        this.doRouter(req,res,req.path,next );
    }
   
    doRouter( req , res , path ,next )
    {
        let ctrobj = null;

        // /testctr/ctrfunc
        // /testctr.ctrunc
        // //subpath/subctr/ctrfunc
        // /subpath/subctr.ctrunfc
        for ( let k of Object.keys(this._routermap) ) 
        {
            if ( path.indexOf(k) == 0 )
            {
                ctrobj = this._routermap[k];
                if (ctrobj instanceof ZWRouter) 
                    ctrobj.doRouter( req, res, path.substring(k.length), next );
                else
                    ctrobj.doRouter( req, res, next );
                return;
            }
        }
        next();
    }
}

module.exports = ZWRouter;