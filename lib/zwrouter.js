
const   express         = require('express');
const   zwbsaectr       = require('./zwbasectr').ctr;

class ZWRouter
{
    /**
     *Creates an instance of ZWRouter.
     * @param {string} pathprefix  路由前缀
     * 
     * 将对应路由前缀请求 路由到  ZWRouter,
     * 
     * ZWRouter在根据配置的控制器进行分发到控制器
     * 
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
     * @returns {Router}
     * @memberof ZWRouter
     */
    getRouter()
    {
        return this._router;
    }

    /**
     * 获取路径前缀
     *
     * @returns {string}
     * @memberof ZWRouter
     */
    getPathPrefix()
    {
        return this._pathprefix;
    }
    /**
     * 注册请求路径前缀 响应的控制器
     * ctrobj 只能是 路由器或者控制器对象
     * 比如 regCtr('/user',UserCtr),将所有/user路径的请求使用UserCtr来处理,
     * @param {string} routername
     * @param {*} ctrobj
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
     * 获取同一个路由下面的控制器
     * 用于控制器直接相互调用
     * @param {string} path-注册路由时候的名字,路径
     * @returns {zwbsaectr}
     * @memberof ZWRouter
     */
    getCtr( path )
    {
        let v = null;
        for( let one of Object.keys( this._routermap ) )
        {
            v = this._routermap[ one ];
            if( one == path )
            {
                //如果路径匹配完了,居然是一个路由器
                if( v instanceof ZWRouter )
                {//没有把路径给全,没办法找到这个路由器下面的具体哪个控制器
                    return null;
                }
                return v;
            }
            //如果是寻找的一个全路径,找到开头了
            else if( path.indexOf( one ) == 0 )
            {//那么一定是一个路由器,如果不是就出问题了
                if( v instanceof ZWRouter )
                {
                    v = v.getCtr( path.substring( one.length ) );
                    if( v != null ) return v;
                }
                return null;
            }
            else if( v instanceof ZWRouter )
            {
                v = v.getCtr( path );
                if( v ) return v;
            }
        }
        return null;
    }
    /**
     * 获取路由器下面所有控制器
     * 
     * @returns {Array<zwbsaectr>}
     * @memberof ZWRouter
     */
    getAllCtrs()
    {
        let r = [];
        let t = Object.keys( this._routermap );
        for( let one of t )
        {
            let v = this._routermap[ one ];
            if( v instanceof ZWRouter )
                r = r.concat( v.getAllCtrs() );
            else
                r.push( v );
        }
        return r;
    }
    /**
     * 通过类名获取控制器,如果有多个同类型的控制器不确定哪个
     *
     * @param {typeof zwbsaectr} classname
     * @returns {zwbsaectr}
     * @memberof ZWRouter
     */
    getCtryByClass( classname )
    {
        let v = null;
        let t = Object.keys( this._routermap );
        for( let one of t )
        {
            v = this._routermap[ one ];
            if( v instanceof ZWRouter ) 
            {
                v = v.getCtryByClass( classname );
                if( v ) return v;
            }
            else if( v instanceof classname ) return v;
        }
        return null;
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