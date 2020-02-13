const zwbase = require('../index');

//测试 的控制器

//先建立项目通用的控制器,这样可以让很多共同行为由这个基础类控制
class prjBaseCtr extends zwbase.ZWBaseCtr
{
    constructor( srv ) {
        super(srv);
    }

    ctrConfig()
    {
        super.ctrConfig();
        this.encryType = 0;
    }
    checkParam( param )
    {
        param.client = 'ios';
        param.version = '1.0';
        param.deviceid = 'aaa';
        return super.checkParam( param );
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
    async ctr_getinfo( param )
    {
        let retobj = { 'info:':'i am cq zw ,test ctr ' };
        retobj.cfginfo = this.getSrv().ctrGetSrvCfgInfo();
        let orderctr = this.importCtr( '/order' );
        retobj.orderinfo = orderctr.testfunc();
        return this.rr( retobj );
    }
    srvStartOk()
    {
        this.log('test ctr srv ok');

        this.startRuningJob(5000);
    }
    job_runing( isSingle )
    {
        this.log('do job ...., is single:' ,isSingle);
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
        this.log('order ctr srv ok')
    }
    async ctr_getorder( param )
    {
        let obj = {}
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
        return this.rr(s );
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
        this.needhttps = false;
        return super.srvConfig();
    }
    cfgRouter( routers )
    {
        let tarr = routers||[];
        let apirouter = new zwbase.ZWRouter( '/api/v1' );
        //下面具体设置 这个 路由的规则
        let ctr = new testCtr( this );
        apirouter.regCtr( '/testctr' , ctr );

        let orderctr = new testOderCtr( this );
        let nextrouter = new zwbase.ZWRouter();
        nextrouter.regCtr( '/order',orderctr );

        apirouter.regCtr( '/subpath/subsubpath', nextrouter );

        apirouter.regCtr('/testpage', new testpage(this) );
  
        //然后配置 到路由里面
        tarr.push( apirouter );
        super.cfgRouter( tarr );
        //然后请求 http://127.0.0.1/api/v1/testctr.getinfo 即可.
        
        
    }
    getHttpsOptions()
    {
        
    }
}

console.log('req http://127.0.0.1/api/v1/testctr.getinfo for test');
let inst = new TestSrv();
inst.start();