const zwbase = require('../index');
//测试 的控制器

//先建立项目通用的控制器,这样可以让很多共同行为由这个基础类控制
class prjBaseCtr extends zwbase.ZWBaseCtr.ctr
{
    constructor( srv ) {
        super(srv);
    }
    checkParam( param)
    {
        param.version = 1;
        param.client = 'mac';
        return super.checkParam( param );
    }
    ctrConfig()
    {
        super.ctrConfig();
        this.encryType = 0;
    }
    //比如加密解密相关的秘钥获取,,可以有这里全部修改了,
    getKeyAndIvForEnc()
    {
        return ["837fe8729c1ba792","6aece0773ffea97b"];
    }
    getKeyAndIvForDec()
    {
        return this.getKeyAndIvForEnc();
    }
}
class testCtr extends prjBaseCtr
{
    ctrConfig()
    {
        super.ctrConfig();
    }
    configRPC()
    {
        super.configRPC();
        this.regRPC( this.ctr_getinfo,'<->' );
        this.regRPC( this.ctr_testrpc,'<->' );
    }
    async ctr_getinfo( param )
    {
        let retobj = {'info:':'i am cq zw ,test ctr :'+ Object.getPrototypeOf(param).constructor.name +',resb at:'+ process.pid};
        //retobj.cfginfo = this.getSrv().ctrGetSrvCfgInfo();
        //let orderctr = this.importCtr( './subpath/subsubpath/order' );
        //retobj.orderinfo = orderctr.testfunc();
        return this.rr( retobj );
    }
    async ctr_testrpc( param )
    {
        let ret = this.makeResb('未知错误');
        try
        {
            ret = await this.ctr_getinfo( param );
        }
        catch(e)
        {
            ret.msg = e.message;
        }
        return this.rr(ret);
    }

    async ctr_test(param)
    {
        return this.rr(  this.getSrv().ctrGetPeerMgr().getAllPeers() );
    }
    srvStartOk()
    {
        super.srvStartOk();
        this.log('test ctr srv ok');

        this.startRuningJob(5000);
    }
    async job_runing( machine_lock ,global_lock ) 
    {
        this.log('do job ....,machinelock:' ,machine_lock,global_lock);
        //继续执行,如果不调用 super.job_runing(); 任务不会在继续了
        super.job_runing();
    }
}

class testOderCtr extends prjBaseCtr
{
    testfunc()
    {
        return 'test order info';
    }
    srvStartOk()
    {
        this.log('order ctr srv ok');
    }
    async ctr_getorder( param )
    {
        let obj = {};
        obj.orderinfo = 'order info';
        return this.rr( obj );
    }
}
class testpage extends prjBaseCtr
{
    async ctr_uploadfile( param )
    {
        return this.rr( JSON.stringify( param.files) );
    }
    async ctr_testupload( param )
    {
        let s = '<!DOCTYPE html>\
        <html lang="en">\
        <head>\
            <meta charset="UTF-8">\
            <title>Title</title>\
        </head>\
        <body>\
        \
        <h1>hello worlds</h1>\
        <form action="/api/v1/testpage.uploadfile" method="post" enctype="multipart/form-data">\
            <p><input type="file" name="upload"></p>\
            <p><input type="file" name="upload2"></p>\
            <p><input type="submit" value="submit"></p>\
        </form>\
        \
        </body>\
        </html>';
        return this.rr( s );
    }
    willSend( param , res , resb )
    {
        //不返回json..
        res.send( resb.data );
    }

}

class TestSrv extends zwbase.ZWBaseSrv
{
    async startDB()
    {
        return new Promise( ( resolve,reject ) => { resolve( null ) } );
    }
    srvConfig()
    {
        super.srvConfig();
        this._cfg.needhttps = 2;
        this._cfg.canRPC = true;
    }
    cfgRouter( routers )
    {
        let tarr = routers||[];
        let apirouter = new zwbase.ZWRouter( '/api/v1' );
        //下面具体设置 这个 路由的规则
        let ctr = new testCtr( this );
        apirouter.regCtr( '/testctr' , ctr );
        //然后请求 http://127.0.0.1/api/v1/testctr.test 即可.

        let orderctr = new testOderCtr( this );
        let nextrouter = new zwbase.ZWRouter('/subpath/subsubpath');
        nextrouter.regCtr( '/order',orderctr );

        apirouter.regCtr( nextrouter.getPathPrefix(), nextrouter );

        apirouter.regCtr('/testpage', new testpage(this) );
  
        //然后配置 到路由里面
        tarr.push( apirouter );
        super.cfgRouter( tarr );
    }
    async job_runing()
    {
        //执行一些任务
        //执行父类任务,会继续下次后台任务执行,如果不调用super.job_runing,任何不会继续了
        return super.job_runing();
    }
}

let inst = new TestSrv();
inst.start();