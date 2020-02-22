 
 class testc
 {
     
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

 class AA extends testc
 {
     Prop2 = '';
 }
 let x = new AA();
 let obj = {};

 Object.assign(obj,x);
 console.log( obj );
 