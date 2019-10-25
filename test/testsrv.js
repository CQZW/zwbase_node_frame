const zwbase = require('../index');

//测试 的控制器

//先建立项目通用的控制器,这样可以让很多共同行为由这个基础类控制
class prjBaseCtr extends zwbase.ZWBaseCtr
{
    constructor(dbobj ) {
        super(dbobj);
        this.encryType = 1;
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
    constructor( dbobj )
    {
        super( dbobj );
    }

    async ctr_getinfo( param )
    {
        let retobj = { 'info:':'i am cq zw ,test ctr ' };
        return new Promise( (resolve,reject)=>{ resolve( zwbase.ZWBaseCtr.makeResb( null,retobj ) )  } );
    }
}

class TestSrv extends zwbase.ZWBaseSrv
{
    async startDB()
    {
        return new Promise( ( resolve,reject ) => { resolve( null ) } );
    }
    async start()
    {
        //测试代码不需要http
        this.needhttps = false;
        
        return super.start();
    }
    cfgRouter()
    {
        let apirouter = new zwbase.ZWRouter();
        //所有 xxx.com/api/v1/ 下面的请求都到 apirouter里面处理
        this.getApp().use( '/api/v1' , apirouter.getRouter() );
        super.cfgRouter();

        //下面具体设置 这个 路由的规则
        let ctr = new testCtr( this.getDB() );
        apirouter.regCtr( '/testctr' , ctr );

        //然后请求 http://127.0.0.1/api/v1/testctr.getinfo 即可.
    }
    getHttpsOptions()
    {

    }
}

console.log('req http://127.0.0.1/api/v1/testctr.getinfo for test');
let inst = new TestSrv();
inst.start();