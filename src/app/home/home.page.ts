import { Component } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';

import { MapComponent } from '../shared/components/map/map.component';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonContent, MapComponent],
})
export class HomePage {
  constructor() {}
}
