
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
        this._pathprefix    =   pathprefix;
        if( !pathprefix || !pathprefix.length ) throw new Error('router must has path');
        //必须是 /order 不能是 /order/ 或者 order/
        if( pathprefix[0] !== '/' || pathprefix[pathprefix.length-1] === '/' ) throw new Error('router path invalid');
        this._routermap     =   [];
        this._router        =   express.Router();
        this._router.all('/*', (req,res,next) => {this.routerMap(req,res,next)} );
        
        /**
         * @type ZWRouter
         */
        this._parentRouter  = null;
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
     * @param {zwbsaectr|ZWRouter} ctrobj
     * @memberof ZWRouter
     */
    regCtr( routername ,ctrobj )
    {
        if( !routername || !routername.length || routername[0] !== '/' ) throw new Error('reg ctr routername invalid');
        //更多规则 http://www.expressjs.com.cn/guide/routing.html,,这里使用最简单的..
        // regCtr('/user',UserCtr),将所有/user路径的请求使用UserCtr来处理,
        //比如  /user.getinfo?userid=xxx 
        //     /user/getinfo?userid=xxx 
        if( ctrobj instanceof ZWRouter )
        {
            this._routermap[ routername ] = ctrobj;
            ctrobj._parentRouter = this;//循环引用!!!
        }
        else
        {
            this._routermap[ routername ] = ctrobj;
            //这里循环引用!!!
            ctrobj.setAtRouter( this );
        }
    }
    /**
     * 获取控制器的路径
     *
     * @returns {string}
     * @memberof ZWRouter
     */
    getPath()
    {
        if( this._mypath ) return this._mypath;
        let p = null;
        if( this._parentRouter ) p = this._parentRouter.getPath() + this._pathprefix;
        else p = this._pathprefix;
        this._mypath = p;
        return p;
    }
    /**
     * 获取控制器的路径
     *
     * @param {zwbsaectr} ctr
     * @returns {string} 返回该控制器的路径
     * @memberof ZWRouter
     */
    getCtrPath( ctr )
    {
        let v = null;
        let t = Object.keys( this._routermap );
        for( let one of t )
        {
            v = this._routermap[ one ];
            if( v === ctr ) return this.getPath() + one;
        }
        return null;
    }
    /**
     * 获取根路由器
     *
     * @returns {ZWRouter}
     * @memberof ZWRouter
     */
    getRootRouter()
    {
        if( this._parentRouter ) return this._parentRouter.getRootRouter();
        return this;//如果没有父级了,就是这个就是这个路由链的根
    }

    
    /**
     * 根据路径获取控制器
     * @param {string} path
     * @returns
     * @memberof ZWRouter
     */
    getCtr( path )
    {
        if( path.startsWith('..') ) 
        {
            // ../order,就是上级的 ./order
            return this._parentRouter.getCtr( path.substring(1) );
        }
        let findpath = path;
        let startat = this;
        if( path.startsWith('.') )
        {
            // ./order -> /order
            findpath = path.substring(1);
        }
        else if( path.startsWith('/') )
        {//表示需要从根开始找,并且是root的前缀,就是从整个根开始
            let r  = this.getRootRouter();
            if( path.startsWith(r._pathprefix) ) return r.getCtr( path.substring( r._pathprefix.length ) );
        }
        /**
         *  @type {ZWRouter}
         */
        let v = null;
        let t = Object.keys( startat._routermap );
        for( let one of t )
        {
            v = startat._routermap[ one ];
            //比如:要找在 /XXX/user 下面找 ./order 就是寻找 /XXX/order ,寻找同级
            if( findpath === one ) 
            {
                //居然是一个路由器?
                if( v instanceof ZWRouter ) return null;
                return v;
            }
            if( findpath.indexOf(one) != 0 ) continue;//如果不是开头匹配,那么肯定不是
            if( !(v instanceof ZWRouter) ) continue;//到这里说明,不是路由器也不是全等匹配,不要
            v = v.getCtr( findpath.substring( one.length ) );
            if( v != null ) return v;
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
     * 通过类名获取控制器,如果有多个同类型的控制器不确定返回哪个
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