//隔离服务框架和控制器逻辑,比如以后不用express框架了,但是希望逻辑代码依然可以继续使用,
//就需要将框架和逻辑隔离开,这里就是隔离的地方
//方法:getReqParams 提前框架的参数 => {   data:{},client,version,,,,,  }
//方法:willSend  返回数据给框架,,,主要就是这2个方法和express框架衔接,,其他都和express框架无关了,
//主要用于api服务,所有没有使用cookie为基础的session
//这里session走的是参数,不是cookie,如果要走cookie,
//如果需要,在getReqParams willSend 方法里面添加即可
//resb 代表的数据结构就是通用的{ code:1,data:{},msg:'xxxx'}
//如果要修改session相关,修改session相关函数即可

const logger    = require('./zwlogger');
const crypto    = require('crypto');
const zwsession = require('./zwsession');
const fs        = require('fs');
const multer    = require('multer');

const diskstorage = multer.diskStorage({
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '_' + Math.random()  );
    }
});
class ZWBaseCtr {

    /** 
     * Creates an instance of ZWBaseCtr.
     * @param {ZWBaseSrv} SrvObj
     * @memberof ZWBaseCtr
     */
    constructor(SrvObj) {
        this._SrvObj = SrvObj;
        this.ctrConfig();

    }

    /**
     * 只要是注册到服务里面的控制器,只要服务启动成功,都会执行这个
     * 这里可以做控制器的一些任务开始之类事情
     * @memberof ZWBaseCtr
     */
    srvStartOk()
    {

    }

    /**
     * 生成 通用数据结构
     * @static
     * @param {*} err
     * @param {*} [obj={}]
     * @param {string} [msg="操作成功"]
     * @returns 通用数据结构
     * @memberof ZWBaseCtr
     */
    static makeResb(err, obj = {}, msg = "操作成功") {
        let ret = {};
        ret.code = err == null ? 0 : 1;
        ret.msg = err != null ? ((typeof err == 'string') ? err : err.message) : msg;
        ret.data = obj;
        return ret;
    }

    /**
     * 快捷生成通用数据结构
     * 
     * @param {*} obj 要返回的对象
     * @returns 通用数据结构
     * @memberof ZWBaseCtr
     */
    rr(obj) {
        //如果已经是通用对象了,就直接返回了
        if( obj.hasOwnProperty('code') && 
            obj.hasOwnProperty('msg') && 
            obj.hasOwnProperty('data') )
        return Promise.resolve( obj);
        return Promise.resolve(this.makeResb(null, obj));
    }

    getLogPrefix()
    {
        return this.constructor.name + ':';
    }

    /**
     * 日志
     * @param {args} str 
     */
    log(message, ...args)
    {
        logger.log( this.getLogPrefix(), message, ...args );
    }

    /**
     * 错误日志
     * @param {args} str 
     */
    error( message, ...args )
    {
        logger.error( this.getLogPrefix() , message, ...args);
    }
    /**
     * 快捷生成通用数据结构
     *
     * @param {*} err 错误描述
     * @returns
     * @memberof ZWBaseCtr
     */
    re(err) {
        return Promise.resolve(this.makeResb(err));
    }

    /**
     * 生成通用 数据结构
     *
     * @param {*} err
     * @param {*} [obj={}]
     * @param {string} [msg="操作成功"]
     * @returns
     * @memberof ZWBaseCtr
     */
    makeResb(err, obj = {}, msg = "操作成功") {
        return ZWBaseCtr.makeResb(err, obj, msg);
    }

    /**
     * 继承修改 修改控制器配置
     * 
     * 先调用 super
     * @memberof ZWBaseCtr
     */
    ctrConfig() {
        //加密方式,0 不加密,1 aes-128-cbc 位加密方式
        this.encryType = 0;
        this.clientTypes = ['ios', 'android', 'mac', 'win', 'wx_xcx'];
        //控制器输入输出的日志是否打印
        
        this.logout = true;
        this.sessionpath = './session/';
    }

    /**
     *
     * 获取服务对象
     * @returns ZWBaseSrv
     * @memberof ZWBaseCtr
     */
    getSrv() {
        return this._SrvObj;
    }

    /**
     * 获取同服务下面的一个控制器实例
     * 如果没有注册,就返回null;
     * @param {*} path
     * @memberof ZWBaseCtr
     */
    importCtr( path )
    {
        let v = null;
        let a = this.getSrv().ctrGetSrvRouters();
        for( let one of a )
        {
            v = one.getCtr( path );
            if( v ) return v;
        }
        return v;
    }
    /**
     * 获取同服务下面的一个控制器实例
     * 根据类名获取实例,如果没有当前注册过的实例就生成一个新的
     * 新实例不会调用 srvStartOK
     * @param {*} calssname
     * @memberof ZWBaseCtr
     */
    instanceCtr( calssname )
    {
        let v = null;
        let a = this.getSrv().ctrGetSrvRouters();
        for( let one of a )
        {
            v = one.getCtryByClass( calssname );
            if( v ) return v;
        }
        if( v == null ) v = new calssname( this.getSrv() );
        return v;
    }

    /**
     * 获取数据库对象,操作数据库
     *
     * @returns 
     * @memberof ZWBaseCtr
     */
    getDB() {
        return this.getSrv().ctrGetDB();
    }
    
    /**
     * 处理上传文件
     *
     * @returns-err/null,接受文件数据
     * @memberof ZWBaseCtr
     */
    async doUploadFile(req,res)
    {
        return new Promise((resolve,reject)=>{
            let uploader = multer( { storage:diskstorage, limits: {fields:10,fileSize:1024*1024*10,files:4} } );
            uploader = uploader.any();
            uploader(req,res,(err)=>{
                resolve(err);
            });
        });
    }
    /**
     * 处理路由,找到对应的 方法,然后分解数据,在这里将框架和逻辑分开.
     * 
     * 框架相关的就是 doRouter和 getReqParams 
     * @param {*} req
     * @param {*} res
     * @param {*} next
     * @memberof ZWBaseCtr
     */
    async doRouter(req, res, next) {
        //检查参数,然后执行方法,返回
        try 
        {
            let param = null;
            param = this.getReqParams(req);//1.
            
            if( this.logout )
                this.log('req param:' ,JSON.stringify( param ) );
            
            //2..
            let checkedparam = await this.checkParam(param);

            if( !checkedparam.resb )
            {//如果没有正常返回数据
                checkedparam.resb = ZWBaseCtr.makeResb( '数据异常' );
            }
            let resb = checkedparam.resb;
            if ( resb.code == 0 )
            {
                //如果是上传文件,先接收文件数据,
                if( this.getFuncNameWithPath(param.path) == 'uploadfile' )
                {
                    let uperr = await this.doUploadFile(req,res);
                    if( uperr )
                        resb = this.makeResb('上传文件失败');
                    else //如果成功了就把文件数据附加到参数里面
                        checkedparam.files = req.files;
                }

                //如果上面的文件处理没有出错就继续下面的流程
                if( resb.code == 0 )
                {//寻找对应的逻辑方法,处理,,
                    let func = this.getRouterFunc(checkedparam);//3.
                    if (func && typeof func == 'function') 
                    {
                        resb = await func.call(this, this.decryptionData(checkedparam));//4.
                    }
                    else 
                    {
                        if (func == null) 
                        {//如果没有找到入口就到root去响应
                            resb = await this.ctr_root(this.decryptionData(checkedparam));//5.
                        }
                        else
                        {
                            logger.error('not find any path in router');
                            throw new Error('not find router');
                        }
                    }
                }
            }

            //逻辑处理完成之后,加密然后返回给框架
            this.willSend( param, res ,resb );//7.
        }
        catch (err) 
        {
            next(err);
        }
        return Promise.resolve();
    }
    /**
     * 将要返回数据,继承修改,可以添加cookie,session之类的操作
     * @param {*} param 请求的参数
     * @param {*} res 框架的返回函数
     * @param {*} resb 需要返回的对象
     * @memberof ZWBaseCtr
     */
    willSend( param , res , resb )
    {
        if( param.sessionid ) resb.sessionid = param.sessionid;

        let dealedresb = this.encryptionData(resb);//6.
        let retstr = JSON.stringify(dealedresb);
        if( this.logout )
            this.log( 'resb data:', retstr );
        res.send( retstr );
    }
    //处理express框架来的数据,
    /**
     * 获取请求参数
     * 
     * 从 express 框架里面提取出参数
     * 如果需要额外的参数,请继承修改行为
     * @param {*} req
     * @returns 通用 param 结构
     * @memberof ZWBaseCtr
     */
    getReqParams(req) {
        //暂时只支持post,get,其他需要自己继承修改行为
        let param = null;
        if (req.method == "POST") {
            param = req.body;
        }
        else if (req.method == "GET") {
            param = req.query || req.params;
        } else return null;

        param = param || {};
        param.path = req.path;
        //如果还需要请求的其他参数,比如什么iP,agent,cookie,session,继承修改

        return param;
    }

    /**
     * 检查所有传入控制器的
     * param 默认通常包含如下参数
     * sessionid,client,lang,version,deviceid,data
     * 
     * 框架默认检查 deviceid ,client,version 是否存在
     * 并且附加扩展参数
     * 继承修改默认的检查逻辑,如果不使用这个检查逻辑最后返回别忘记了resb字段
     * @param {*} param
     * @returns param,在 param基础上多返回一个 resb (通用数据结构)表明是否检查通过,成功
     * @memberof param
     */
    async checkParam(param) {
        let ret = ZWBaseCtr.makeResb('无效的参数!');

        do
        {
            /*
                    client:'ios/android/mac/win',
                    lang:'zh',
                    version:'1.0',
                    deviceid:'ddddd',
                    sessionid:'xxx',
                    */

            if (!param ||
                !param.client ||
                !param.version ||
                !param.deviceid 
            ) 
            {
                ret.msg = "无效的参数!";
                ret.code = 9998;
                break;
            }

            if (this.clientTypes.indexOf(param.client) == -1) {
                ret.msg = '无效的访问来源';
                ret.code = 9998;
                break;
            }
            //这里附加个参数,让ctr可以自然的判断来源是不是小程序
            param.bxcx = param.client.indexOf('xcx') != -1;

            //如果在获取参数就添加了session,这里返回空或者返回一样
            let t = await this.getSession( param );
            if( t ) {param.session = t;param.sessionid = t.sessionid;}
            else 
            {
                ret.msg = '服务器错误';
                ret.code = 9997;
                break;
            }
            
            if ( !await this.checkToken( this.getFuncNameWithPath( param.path ) ,param  )  )
            {
                ret.code = 9999;//返回这个错误码,需要客户端进行登录操作
                ret.msg = '无效的token';
                break;
            }

            ret.code = 0;
            ret.msg = '操作成功';

        } while (0);

        //千万注意别忘记了这行, doRouter 要要根据 resb字段来判断是否检查参数成功了
        param.resb = ret;
        return new Promise((resolve, reject) => { resolve(param) });
    }

    /**
     * 检查token操作,
     *
     * @param {*} ctrfuncname-请求的响应的函数名
     * @param {*} param
     * @returns
     * @memberof ZWBaseCtr
     */
    async checkToken( ctrfuncname,param )
    {
        return Promise.resolve( true );
    }

    /**
     * 这里session用文件存储,可以自己继承修改
     * 获取session,如果没有会生成新的session,并且对param添加sessionid字段
     * 会更新session过期时间到最新
     * @param {*} param
     * @returns
     * @memberof ZWBaseCtr
     */
    async getSession( param )
    {
        let cache = this.getSrv().ctrGetCache();
        let v;
        if( param.sessionid )
        {
            v = cache.get( param.sessionid );
            if( v )
            {
                if( !v.isVaild() )
                {
                    cache.del( param.sessionid );
                    this.delSession( v );
                }
                else
                {
                    v.touch();
                    return Promise.resolve(v);  
                }
            }
            v = await this.loadSession( param.sessionid );
            if( v )
            {
                if( !v.isVaild() )
                {
                    this.delSession(v);
                }
                else 
                {
                    v.touch();
                    cache.set( v.sessionid , v );
                    return Promise.resolve(v);
                }
            }
        }
        
        //如果持久化存储里面依然不存在,那么重新生成了,
        v = await this.makeSession( param );

        //更新缓存
        cache.set( v.sessionid , v );

        return Promise.resolve(v);
    }
    /**
     * 从持久化存储里面加载session
     *
     * @param {*} sessionid
     * @returns
     * @memberof ZWBaseCtr
     */

    async loadSession( sessionid )
    {
        return new Promise( (resolve,reject)=>{
            let path = this.sessionpath + sessionid + '.sess';
            fs.readFile( path ,(err,data )=>{
                if( err ) resolve( null);
                else
                {
                    resolve(  zwsession.createSessionWithJson ( data.toString() ) );
                }
            });
        });
    }
    async loadAllSessionToCache()
    {
        //加载所有文件到cache即可,这里无顺序
        let cache = this.getSrv().ctrGetCache();
        let max = this.getSrv().srvConfig().maxcache;
        let path = this.sessionpath;
        let files = await fs.promises.readdir( path );
        this.log('load session ...');
        let i = 0;
        for( ; i < files.length;i++)
        {
            let one = files[i];
            if( one.indexOf( '.sess') == -1 ) continue;
            let buf = await fs.promises.readFile( path + one );
            if( !buf ) continue;
            buf = buf.toString();
            let obj = zwsession.createSessionWithJson( buf );
            if( !obj )
            {
                fs.promises.unlink( path+one);
                continue;
            }
            cache.set( obj.sessionid,obj);
            if( i >= max ) break;
        }
        this.log('load session :',i);
        return Promise.resolve( true );
    }

    /**
     * 存储session到持久化存储
     * 
     * @param {*} session
     * @returns
     * @memberof ZWBaseCtr
     */
    async dumpSession( session )
    {
        if( session.isNeedDump() )
        {
            this.log('will dump session:',session.sessionid);
            let dumpstr = JSON.stringify( session );
            return new Promise( (resolve,reject)=>{
                let path = this.sessionpath + session.sessionid+ '.sess';
                fs.writeFile( path ,dumpstr,(err)=>{
                    resolve( err == null );
                    session.dumped();
                });
            });
        }
        return Promise.resolve( true );
    }
    async delSession( session )
    {
        return fs.promises.unlink( this.sessionpath + session.sessionid+ '.sess' );
    }

    /**
     * 生成新的session
     *
     * @param {*} param
     * @returns
     * @memberof ZWBaseCtr
     */
    async makeSession( param )
    {//创建一个新的session 信息
        return Promise.resolve( new zwsession(param) );
    }

    /**
     * 从请求路径 里面提取出控制器的响应方法名称
     * 
     * 比如 user.getinfo 返回 getinfo
     * @param {*} path
     * @returns 方法名字
     * @memberof ZWBaseCtr
     */
    getFuncNameWithPath(path) {

        //XXXX testctr.func
        //XXXX testctr/func
        let i = path.lastIndexOf('.');
        if( i != -1 )
            return path.substring(i+1);
        i = path.lastIndexOf('/');
        if( i != -1 )
            return path.substring(i+1);
        return null;
    }

    //根据path寻找合适的方法,继承可修改该行为
    //路由方法,必须返回 Promise 对象
    //规则,枚举对象里面的 ctr_ 开头的方法,作为响应方法 
    // 比如/user.getinfo 需要寻找 user对象下面 ctr_getinfo的方法
    /**
     * 根据请求参数 返回响应的方法
     * 
     * @param {*} param
     * @returns function类型
     * @memberof ZWBaseCtr
     */
    getRouterFunc(param) {
        if (!this instanceof ZWBaseCtr) return null;
        let funcname = 'ctr_' + this.getFuncNameWithPath(param.path);
        return this[funcname];
    }


    /**
     * 从请求参数里面解密数据 
     * 
     * 继承修改解密逻辑
     * @param {*} param
     * @returns
     * @memberof ZWBaseCtr
     */
    decryptionData(param) {
        if (this.encryType == 0) return param;
        if (this.encryType == 1) {
            //将 resb.data 字段进行解密,
            let desdata = '';
            let srcdata = param.data;
            if (!srcdata || typeof srcdata != 'string' || !srcdata.length) {
                param.data = {};
                return param;
            }
            srcdata = new Buffer(srcdata, 'base64');
            let t = this.getKeyAndIvForDec(param);
            const decipher = crypto.createDecipheriv('aes-128-cbc', t[0], t[1]);
            desdata += decipher.update(srcdata, 'base64', 'utf8');
            desdata += decipher.final('utf8');
            param.data = JSON.parse(desdata);
            return param;
        }
        return param;
    }

    /**
     * 将准备返回的数据加密
     *
     * 继承修改加密逻辑
     * @param {*} resb 通用数据结构
     * @returns 通用数据结构
     * @memberof ZWBaseCtr
     */
    encryptionData(resb) {
        if (this.encryType == 0) return resb;
        if (this.encryType == 1) {
            //将 resb.data 字段进行加密,
            let desdata = '';
            let srcdata = resb.data;
            if (!srcdata || resb.code) {
                resb.data = "";
                return resb;
            }
            srcdata = JSON.stringify(srcdata);
            let t = this.getKeyAndIvForEnc(resb);
            const cipher = crypto.createCipheriv('aes-128-cbc', t[0], t[1]);
            desdata += cipher.update(srcdata, 'utf8', 'base64');
            desdata += cipher.final('base64');
            resb.data = desdata;
            return resb;
        }
        return resb;
    }

    /**
     * 获取加密用的 key iv
     * 
     * 继承修改秘钥返回
     * @param {*} resb
     * @returns [],[key,iv]
     * @memberof ZWBaseCtr
     */
    getKeyAndIvForEnc(resb) {
        // ase-128-cbc 加密算法要求key和iv长度都为16
        logger.error('your must change key and iv in your prj');
        let _key = "837fe8729c1ba792";
        let _iv = "6aece0773ffea97b";
        return [_key, _iv];
    }
    /**
     * 获取解密的key iv
     *  
     * 继承修改秘钥返回
     * @param {*} param
     * @returns [],[key,iv]
     * @memberof ZWBaseCtr
     */
    getKeyAndIvForDec(param) {
        logger.error('your must change key and iv in your prj');
        return this.getKeyAndIvForDec();
    }

    /**
     *
     * 开始后台任务
     * @param {number} [time_ms=10000]
     * @memberof ZWBaseCtr
     */
    startRuningJob( time_ms = 10000 ) {
        this._time_ms = time_ms;
        this.getSrv().ctrRobSingleJobPower().then( (bsingle)=>{
            setTimeout(()=>{this.job_runing(bsingle)}, time_ms);
        });
    }

    /**
     * 后台任务方法,
     * 子类继承之后,调用super可以继续执行,否则不会继续执行任务
     * @param {*} isSingle-当前任务是不是本机器唯一任务
     * @returns
     * @memberof ZWBaseCtr
     */
    async job_runing( isSingle ) {
        this.getSrv().ctrRobSingleJobPower().then( (bsingle)=>{
            setTimeout( ()=>{this.job_runing(bsingle)}, this._time_ms );
        });
        return Promise.resolve();
    }
    //路由响应函数,全部用ctr_开头,全部需要返回  Promise
    /**
     *上传文件控制器响应函数,param里面包含文件参数,files,
     * 具体参考 multer,继承修改该方法,一个控制器上传文件方法仅此一个就够了
     * @param {*} param. param 会添加 files参数,
     * @memberof ZWBaseCtr
     */
    async ctr_uploadfile( param )
    {
        return new Promise((resolve, reject) => { resolve(ZWBaseCtr.makeResb('not any one can do uploadfile ...')) });
    }
    /**
     * 控制器 根 响应
     * 
     * 如果该路由前缀找不到对应的响应方法 由 这里处理
     * 
     * 比如 user.getxxx 找不到 getxxx 都到这里响应
     * @param {*} param
     * @returns 通用数据结构
     * @memberof ZWBaseCtr
     */
    async ctr_root(param) {
        return new Promise((resolve, reject) => { resolve(ZWBaseCtr.makeResb('not any one can do this...')) });
    }

}

module.exports = ZWBaseCtr;
