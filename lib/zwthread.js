/*
线程,任务队列,信号等待,QPS控制 等操作,多线程需要的相关操作
node 里面所谓线程 定时器就可以模拟一个线程,比如 settimeout ,当定时器回调就可以认为是一个线程
在定时器里面就可以进行模拟多线程的操作,比如等待其他事件.

*/
const   EventEmitter    = require('events');

/**
 * 信号对象,用于其他线程等待另外线程返回数据
 *
 * @class ZWSignalObject
 */
class ZWSignalObject
{
    
    /**
     *  
     * @param {number} [maxwaper=200],
     * 当无人等待的时候最大缓存多个数据,供延迟通知,设置-1不允许延迟通知
     * @memberof ZWSignalObject
     */
    constructor( maxwaper = 200 )
    {
        this._event = new EventEmitter();
        this._nameWaper = [];
        this._objWaper  = [];
        this._waperMax  = maxwaper;

    }
    _makeEventName()
    {
        //return 'signal_' + Math.random();
        return Symbol('signalname');
    }

    /**
     * 开始等待这个信号事件
     *
     * @param {number} [waitms=0] <=0 就是一直等待
     * @returns 返回等待的结果,超时返回 null
     * @memberof ZWSignalObject
     */
    async wait( waitms = 0 )
    {
        let t = this._objWaper.shift();
        if( t )
        {//如果对象容器里面有对象了,说明刚刚有通知了,你还没开始等,那么直接先返回给你
            return Promise.resolve( t );
        }
        return new Promise( (resolve,reject) => {
            let t = this._makeEventName();
            this._nameWaper.push( t );
            this._event.once( t ,(x)=>{ process.nextTick( resolve,x ); } );
            if( waitms > 0 ) this._timeout( waitms ,t );
        });
    }
    _timeout( ms , name )
    {
        setTimeout( ()=> {
            let t = [];
            for(let one of this._nameWaper )
            {
                if( one === name ) continue;
                t.push(one);
            }
            this._nameWaper = t;//node 没办法 真正的多线程同时操作一个对象,所有可以这样操作
            this._event.emit( name ,null );
        }, ms );
    }

    /**
     * 通知这个事件的等待者,如果没有人在等待这个世界,会投入队列缓存,并返回成功,
     * 如果队列缓存设置为-1,才会失败
     * @param {*} obj 要传递的数据,不要null,否则对方误以为是超时了
     * @returns {Promise<boolean>} 返回通知成功或者失败
     * @memberof ZWSignalObject
     */
    async notify( obj )
    {
        let name = this._nameWaper.shift();         
        let r = this._event.emit(name,obj);
        if( !r )
        {//如果 当前并没有人接收这个事件
            if( this._objWaper.length > this._waperMax )
                return Promise.resolve(false);//如果队列满就直接报错了
            else
                this._objWaper.push( obj );//如果还可以放到队列里面就放,有人一来监听就返回数据
        }
        return Promise.resolve(true);
    }
    
    /**
     * 获取当前信号状态
     * 有多少人等待,对象缓存里面有多少
     * @returns
     * @memberof ZWSignalObject
     */
    getstatus()
    {
        return { 'waiting':this._event.eventNames() ,'objarr':this._objWaper.length }
    }
}

/**
 * 控制QPS请求
 *
 * @class ZWQPSCtr
 */
class ZWQPSCtr
{
    /**
     *Creates an instance of ZWQPSCtr.
     * @param {number} c-每秒可以进行多少次请求,
     * @memberof ZWQPSCtr
     */
    constructor( c )
    {
        this._qps = c;
        this._lastreq = 0;
        this._correct = 0;//误差设置,比如设置10,表示睡眠的时候多睡眠10毫秒
        if(  !isNaN(c) ) this._min_req_gap = 1000/c;//每秒的请求最小间隔
        else this._min_req_gap = 0;//没有间隔,后面会报错
    }
    /**
     * 检查QPS是否允许,如果距离上次请求间隔太小了就睡眠下
     *
     * @memberof ZWQPSCtr
     */
    async checkQPS()
    {
        if( this._min_req_gap == 0 ) return new Promise( function(resolve,reject){ reject( 'qps ctr error' ) } );
        let t = new Date().getTime();
        let gap = t - this._lastreq;
        if( gap < this._min_req_gap )
        {//间隔太小了,,,睡眠下,
            await this.sleep( this._min_req_gap - gap + this._correct );
        }
        this._lastreq = new Date().getTime();
        return new Promise( function(resolve,reject){ resolve( ) } );
    }

    async sleep(ms)
    {
        return new Promise(function(resolve,reject){ 
            setTimeout( ()=>{ resolve();},ms);
        });
    }
}

/**
 * 一个任务队列线程
 * 可以实现串行任务处理,等待任务结果,添加任务
 * 
 * 比如要实现一个请求第3方的API服务,但是第3方有QPS限制,这时候如果已经有大量任务在循环处理了
 * 这时候新来一个任务,不能自己发起第3方API请求,否则可能导致QPS过高,那就将这个任务注入 任务队列线程,并且可以一直等待返回结果
 * @class ZWJobArrayThread
 */
class ZWJobArrayThread
{
    /**
     * threadfunc 执行任务的实际方法,必须是异步方法,返回Promise
     */
    constructor( threadfunc ,maxjobarr = 1000 )
    {
        this._threadfunc = threadfunc;
        this._jobarrmax = maxjobarr;
    }

    start()
    {
        if( this._signalobj ) return false;
        this._signalobj = new ZWSignalObject(this._jobarrmax);
        this._loop();
        return true;
    }
    /**
     * 停止任务队列线程
     * @returns {Promise} 等待所有任务完成的 Promise
     * @memberof ZWJobArrayThread
     */
    async stop()
    {
        this._stopsingal = new ZWSignalObject();
        this._stop = 1;
        this._signalobj.notify(null);
        return this._stopsingal.wait();
    }
    async _loop()
    {
        try
        {
            while(1)
            {
                let jobinfo = await this._signalobj.wait(this._stop?1:0);
                //没有数据?不可能,那要停止了,
                if( !jobinfo ) break;
                let d = await this._threadfunc( jobinfo.j );
                if( jobinfo.w ) jobinfo.w.notify( d );
            }
        }
        catch(e)
        {

        }
        //如果异常了,没有停止需求就重新再次开始
        if( !this._stop ) setTimeout( ()=>{this._loop(),10* 1000} );
        else this._stopsingal.notify({});
    }
    /**
     * 添加一个任务
     *
     * @param {*} job
     * @param {ZWSignalObject} [waitsignal=null] 自定义的等待对象
     * @returns {Promise<boolean>}
     * @memberof ZWJobArrayThread
     */
    async addOneJob( job ,waitsignal = null ) 
    {
        if( this._stop ) return Promise.resolve( false );
        return this._signalobj.notify( { j:job,w:waitsignal } );
    }
    
    /**
     * 向任务线程添加一个任务,然后等待返回结果
     *
     * @param {*} job
     * @param {number} [waitms=0]
     * @param {ZWSignalObject} [waitsignal=null] 自定义的等待对象,如果不指定,自动创建并且在其上等待
     * @returns {Promise} 返回数据 {r:添加成功/失败 true/false,d:线程方法返回的数据}
     * @memberof ZWJobArrayThread
     */
    async addOneJobAndWait( job ,waitms = 0 , waitsignal = null )
    {
        let w = waitsignal;
        if( !w ) w = new ZWSignalObject();
        let a =  await this.addOneJob(job,w);
        if( !a ) return Promise.resolve({r:false,d:null});
        let d =  await w.wait(waitms);
        return Promise.resolve({r:true,d:d});
    }
}

let exp = {};

exp.ZWSignalObject  = ZWSignalObject;
exp.ZWQPSCtr        = ZWQPSCtr;
exp.ZWJobArrayThread= ZWJobArrayThread;

module.exports = exp;