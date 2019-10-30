
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
     * @param {*} ctrobj
     * @memberof ZWRouter
     */
    regCtr( routername ,ctrobj )
    {
        //更多规则 http://www.expressjs.com.cn/guide/routing.html,,这里使用最简单的..
        // regCtr('/user',UserCtr),将所有/user路径的请求使用UserCtr来处理,
        //比如  /user.getinfo?userid=xxx 
        //     /user/getinfo?userid=xxx 
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
    routerMap( req , res , next )
    {
        let reqpath = req.path;
        let ctrobj  = null;
        do
        {//根据路由寻找控制器对象
            //1.寻找全路径的匹配
            ctrobj = this._routermap[ reqpath ];
            if( ctrobj ) break;

            //匹配前缀,如果是使用 . 分隔的,
            let tarr = reqpath.split('.');
            if( tarr && tarr.length == 2 )
            {
                tarr = tarr[0];
                ctrobj = this._routermap[ tarr ];
                if( ctrobj ) break;
            }

            //匹配前缀,如果是使用 / 分隔的,
            tarr = reqpath.split('/');
            if( tarr && tarr.length == 3 )
            {
                tarr = tarr[0];
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