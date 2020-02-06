 
 class testc
 {
     constructor(a) {
         
     }
     Prop1 = 1;

     getinfo()
     {
         return '222';
     }
     toJSON()
     {
         return '11';
     }
 }

 let obj = new testc();
 console.log( JSON.stringify( obj ) );
 