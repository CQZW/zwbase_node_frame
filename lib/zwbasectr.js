//隔离服务框架和控制器逻辑,比如以后不用express框架了,但是希望逻辑代码依然可以继续使用,
//就需要将框架和逻辑隔离开,这里就是隔离的地方

//resb 代表的数据结构就是通用的{ code:1,data:{},msg:'xxxx'}

const logger = require('./zwlogger');
const crypto = require('crypto');
const dgram = require('dgram');

class ZWBaseCtr {

    /**
     *Creates an instance of ZWBaseCtr.
     * @param {*} SrvObj -ZWBaseSrv
     * @memberof ZWBaseCtr
     */
    constructor(SrvObj) {
        this._SrvObj = SrvObj;
        this.ctrConfig();

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

    /**
     * 日志
     * @param {args} str 
     */
    log(message, ...args)
    {
        logger.log( message, ...args );
    }

    /**
     * 错误日志
     * @param {args} str 
     */
    error( message, ...args )
    {
        logger.error(message, ...args);
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
        
        //后台任务是否只要一个,防止多个,因为通常node可以使用fork,cluster,启动多个服务实例,
        //但是,后台任务是和ctr绑定的,那么可能就不需要那么多的后台任务,只需要一个执行,
        this.job_single = false;
        this.lockport = 5005;

        //控制器输入输出的日志是否打印
        this.loginout = true;

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
     * 获取数据库对象,操作数据库
     *
     * @returns 
     * @memberof ZWBaseCtr
     */
    getDB() {
        return this.getSrv().ctrGetDB();
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
    doRouter(req, res, next) {
        //检查参数,然后执行方法,返回
        let param = null;
        try {
            param = this.getReqParams(req);//1.
        }
        catch (err) {
            next(err);
            return;
        }

        if( this.loginout )
            this.log('req param:' ,JSON.stringify( param ) );

        this.checkParam(param).then((checkedparam) => {//2.

            if (checkedparam.resb.code == 0) {
                //寻找对应的逻辑方法,处理,,
                let func = this.getRouterFunc(checkedparam);//3.
                if (func && typeof func == 'function') {
                    return func.call(this, this.decryptionData(checkedparam));//4.
                }
                else {
                    if (func == null) {//如果没有找到入口就到root去响应
                        return this.ctr_root(this.decryptionData(checkedparam));//5.
                    }
                    logger.error('not find any path in router');
                    throw new Error('not find router');
                }
            }
            else {
                return new Promise((resolve, reject) => { resolve(checkedparam.resb) })
            }
        }).then((resb) => {
            //逻辑处理完成之后,加密然后返回给框架
            let dealedresb = this.encryptionData(resb);//6.
            let retstr = JSON.stringify(dealedresb);
            if( this.loginout )
                this.log( 'resb data:', retstr );
            res.send( retstr );//7.
        })
            .catch((err) => { next(err) });
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
        //如果还需要请求的其他参数,比如什么iP,agent,,继承修改

        return param;
    }


    /**
     * 该请求是否需要避开token合法性检查
     * 
     * 有些请求需要暂时避开检查,比如,初始化,登录等
     * 
     * 通常只有 1,2个请求需要避开
     * @param {*} funcname
     * @returns bool
     * @memberof ZWBaseCtr
     */
    isIgnoreCheckToken(funcname) {
        return true;//默认所有都不检查,,子类自己判断
    }

    /**
     * 检查所有传入控制器的
     * param 默认通常包含如下参数
     * token,userid,client,lang,version,deviceid,data
     * 
     * 框架默认检查 token ,client,version 是否存在
     * 并且附加扩展参数
     * 继承修改默认的检查 逻辑
     * @param {*} param
     * @returns 通用数据
     * @memberof param
     */
    async checkParam(param) {
        let ret = ZWBaseCtr.makeResb('无效的参数!');

        do {

            /*
                    token:'xxxxx',
                    userid:1,
                    client:'ios/android/mac/win',
                    lang:'zh',
                    version:'1.0',
                    deviceid:'ddddd',*/

            if (!param ||
                !param.client ||
                !param.version
            ) {
                ret.msg = "无效的参数!";
                ret.code = 9998;
                break;
            }

            if (this.clientTypes.indexOf(param.client) == -1) {
                ret.msg = '无效的访问来源';
                ret.code = 9998;
            }
            //这里附加个参数,让ctr可以自然的判断来源是不是小程序
            param.bxcx = param.client.indexOf('xcx') != -1;

            if (!this.isIgnoreCheckToken(this.getFuncNameWithPath(param.path)) && !param.token) {
                ret.code = 9999;
                ret.msg = '无效的token';
                break;
            }
            //更多参数检查,,继承修改行为,比如去数据库查询userid,之类的,


            ret.code = 0;
            ret.msg = '操作成功';

        } while (0);

        param.resb = ret;
        return new Promise((resolve, reject) => { resolve(param) });
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
     * 开启后台任务,
     * @param {*} time_ms 默认 10秒
     */
    startRuningJob(time_ms = 10000) {
        if( this.job_single )
        {//如果后台任务需要单例,那么需要进行判断抢占是否可以运行
            this.isCanStartJob().then( (can)=>{
                if( can ) 
                {
                    this.log('get single job port',this.lockport,',run job at pid:',process.pid);
                    this._time_ms = time_ms;
                    setTimeout(()=>{this.job_runing()}, time_ms);
                }
                else 
                {
                    this.log('not get single job port', this.lockport ,',so not run job for pid:',process.pid);
                }
            });
        }
        else 
        {
            this._time_ms = time_ms;
            setTimeout(()=>{this.job_runing()}, time_ms);
        }
    }
    
    /**
     * 是否可以启动后台任务
     * 这里只现实通过抢占端口方式实现,继承修改,比如通过数据库全局唯一,
     * @memberof ZWBaseCtr
     */
    async isCanStartJob()
    {
        return new Promise( (resolve,reject)=>{
            const s = dgram.createSocket('udp4');
            s.on( 'error',(err)=>{
                if( err.code == 'EADDRINUSE' ) resolve( false );
            });
            s.bind( {   address: 'localhost',
                        port: this.lockport,
                        exclusive: true } ,()=>{
                            resolve(true);
                        });
        });
    }
    /**
     * 所有后台任务,如果需要该控制器逻辑需要有后台任务的, 
     * 当子类任务完成,调用super.job_runing 可以保持任务继续.
     * @memberof ZWBaseCtr
     */
    async job_runing() {
        setTimeout(()=>{this.job_runing()}, this._time_ms );
        return Promise.resolve();
    }
    //路由响应函数,全部用ctr_开头,全部需要返回  Promise

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
